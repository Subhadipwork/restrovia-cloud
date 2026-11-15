/** The marketing site's enquiry form: validation, dedupe, CORS, throttle and the admin panel view. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { EmailService } from '../src/email/email.service.js';
import { normalizePhone } from '../src/leads/public-lead-schema.js';
import * as schema from '../src/db/schema/index.js';
import { createTestApp, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let admin: ReturnType<typeof request.agent>;

const SITE = 'https://restrovia.shop';
const form = (extra: Record<string, unknown> = {}) => ({
  contact_name: 'Asha Rao',
  business_name: 'Chai Point',
  phone: '98765 43210',
  consent: true,
  ...extra,
});
const post = (body: unknown, origin = SITE) =>
  request(app.getHttpServer()).post('/api/public/leads').set('Origin', origin).send(body as object);
const byPhone = (phone: string) =>
  db.select().from(schema.leads).where(eq(schema.leads.phoneE164, phone));

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  process.env.PUBLIC_FORM_LIMIT = '1000';
  process.env.LEADS_NOTIFY_EMAIL = 'sales@restrovia.test';
  app = await createTestApp(url);
  const crypto = app.get(CryptoService);
  const [row] = await db
    .insert(schema.admins)
    .values({
      name: 'Test super',
      email: `super-${randomUUID().slice(0, 8)}@restrovia.test`,
      roleId: SYSTEM_ROLE_IDS.super_admin,
      passwordHash: await crypto.hashPassword('correct horse battery'),
    })
    .returning();
  admin = request.agent(app.getHttpServer());
  await admin
    .post('/api/admin/auth/login')
    .set({ 'X-Restrovia-Admin': '1' })
    .send({ email: row!.email, password: 'correct horse battery' })
    .expect(200);
});

afterAll(async () => {
  delete process.env.PUBLIC_FORM_LIMIT;
  delete process.env.LEADS_NOTIFY_EMAIL;
  await app?.close();
  await pool?.end();
});

describe('phone numbers', () => {
  it('reads Indian mobiles with or without a prefix and rejects the rest', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('+1 415 555 0100')).toBe('+14155550100');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('4155550100')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
});

describe('website enquiry', () => {
  it('saves an unassigned website lead without an email and shows it in the admin panel', async () => {
    const res = await post(form({ message: 'Need a POS for two outlets', city: 'Kolkata' })).expect(
      200,
    );
    expect(res.body).toEqual({ ok: true });

    const [lead] = await byPhone('+919876543210');
    expect(lead).toMatchObject({
      businessName: 'Chai Point',
      contactName: 'Asha Rao',
      email: null,
      city: 'Kolkata',
      source: 'website',
      stage: 'new',
      assignedAdminId: null,
      createdByAdmin: null,
    });
    expect(lead!.consentAt).toBeInstanceOf(Date);

    const list = await admin.get('/api/admin/leads').query({ source: 'website' }).expect(200);
    expect(list.body.data.map((l: { id: string }) => l.id)).toContain(lead!.id);
    const detail = await admin.get(`/api/admin/leads/${lead!.id}`).expect(200);
    expect(detail.body.lead.phoneE164).toBe('+919876543210');
    const timeline = await admin.get(`/api/admin/leads/${lead!.id}/activities`).expect(200);
    expect(JSON.stringify(timeline.body)).toContain('Need a POS for two outlets');
  });

  it('emails the sales inbox with a link to the lead', async () => {
    const mail = app.get(EmailService).outbox.at(-1)!;
    expect(mail.to).toBe('sales@restrovia.test');
    expect(mail.subject).toContain('Chai Point');
    expect(mail.text).toContain('+919876543210');
    expect(mail.text).toContain('Email: not given');
    expect(mail.text).toContain('/dashboard/leads/');
  });

  it('keeps an email when one is given, and rejects a bad one', async () => {
    await post(form({ phone: '9811111111', email: 'asha@chai.example' })).expect(200);
    const [lead] = await byPhone('+919811111111');
    expect(lead!.email).toBe('asha@chai.example');
    await post(form({ phone: '9822222222', email: 'not-an-email' })).expect(400);
    await post(form({ phone: '9833333333', email: '' })).expect(200);
    expect((await byPhone('+919833333333'))[0]!.email).toBeNull();
  });

  it('needs a name, a valid phone number and consent', async () => {
    await post(form({ phone: undefined })).expect(400);
    await post(form({ phone: '12345' })).expect(400);
    await post(form({ contact_name: '  ' })).expect(400);
    await post(form({ consent: false })).expect(400);
    await post(form({ consent: undefined })).expect(400);
  });

  it('uses the name as the business name when no restaurant is given', async () => {
    await post(form({ phone: '9844444444', business_name: '' })).expect(200);
    expect((await byPhone('+919844444444'))[0]!.businessName).toBe('Asha Rao');
  });

  it('adds a note and heats up the lead when the same phone writes again', async () => {
    await post(form({ phone: '9855555555', message: 'First message' })).expect(200);
    const [first] = await byPhone('+919855555555');
    await db.update(schema.leads).set({ temperature: 'cold' }).where(eq(schema.leads.id, first!.id));
    await post(form({ phone: '+91 98555 55555', message: 'Any update?' })).expect(200);

    const rows = await byPhone('+919855555555');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.temperature).toBe('hot');
    const notes = await db
      .select()
      .from(schema.leadActivities)
      .where(eq(schema.leadActivities.leadId, first!.id));
    expect(notes.map((n) => n.body).join('|')).toContain('Submitted the website form again');
    expect(notes.map((n) => n.body).join('|')).toContain('Any update?');
  });

  it('silently drops a filled honeypot', async () => {
    const res = await post(form({ phone: '9866666666', website: 'http://spam.example' })).expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(await byPhone('+919866666666')).toHaveLength(0);
  });

  it('refuses an oversized body', async () => {
    await post(form({ phone: '9877777777', message: 'x'.repeat(1900), pad: 'y'.repeat(3000) })).expect(
      413,
    );
    expect(await byPhone('+919877777777')).toHaveLength(0);
  });

  it('keeps only the utm fields it knows', async () => {
    await post(
      form({ phone: '9888888888', utm: { utm_source: 'insta', utm_campaign: 'diwali', other: 'x' } }),
    ).expect(200);
    expect((await byPhone('+919888888888'))[0]!.utm).toEqual({
      utm_source: 'insta',
      utm_campaign: 'diwali',
    });
  });
});

describe('CORS and throttle', () => {
  it('answers the preflight and the post for the marketing site only', async () => {
    const ok = await request(app.getHttpServer())
      .options('/api/public/leads')
      .set('Origin', SITE)
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe(SITE);
    expect(ok.headers['access-control-allow-methods']).toContain('POST');

    const other = await request(app.getHttpServer())
      .options('/api/public/leads')
      .set('Origin', 'https://evil.example')
      .expect(204);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();

    const posted = await post(form({ phone: '9899999999' }), 'https://evil.example').expect(200);
    expect(posted.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits posts per address', async () => {
    process.env.PUBLIC_FORM_LIMIT = '2';
    const from = (phone: string) => post(form({ phone })).set('X-Forwarded-For', '203.0.113.9');
    await from('9700000001').expect(200);
    await from('9700000002').expect(200);
    await from('9700000003').expect(429);
    expect(await byPhone('+919700000003')).toHaveLength(0);
    process.env.PUBLIC_FORM_LIMIT = '1000';
  });
});
