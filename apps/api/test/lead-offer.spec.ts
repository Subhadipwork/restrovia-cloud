/** The WhatsApp welcome offer: who gets it, what it carries and what the timeline shows. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { LeadOfferService } from '../src/leads/lead-offer.service.js';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service.js';
import { createTestApp, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
const BANNER = 'https://restrovia.test/offer-banner.png';
const CSRF = { 'X-Restrovia-Admin': '1' };
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let admin: ReturnType<typeof request.agent>;
let whatsapp: WhatsAppService;

const activities = (leadId: string) =>
  db.select().from(schema.leadActivities).where(eq(schema.leadActivities.leadId, leadId));

/** The offer goes out after the response, so wait for the timeline entry it writes. */
async function offerActivity(leadId: string) {
  for (let i = 0; i < 50; i++) {
    const row = (await activities(leadId)).find((a) => a.type === 'whatsapp');
    if (row) return row;
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
}

const sentTo = (phone: string) => whatsapp.outbox.filter((m) => m.to === phone);

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  process.env.PUBLIC_FORM_LIMIT = '1000';
  process.env.WHATSAPP_LEAD_OFFER_IMAGE_URL = BANNER;
  app = await createTestApp(url);
  whatsapp = app.get(WhatsAppService);
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
  delete process.env.WHATSAPP_LEAD_OFFER_IMAGE_URL;
  await app?.close();
  await pool?.end();
});

describe('website enquiry', () => {
  it('sends the offer with the banner, name and business, and logs it on the lead', async () => {
    await request(app.getHttpServer())
      .post('/api/public/leads')
      .set('Origin', 'https://restrovia.shop')
      .send({ contact_name: 'Asha Rao', business_name: 'Chai Point', phone: '9876543210', consent: true })
      .expect(200);
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.phoneE164, '+919876543210'));
    const logged = await offerActivity(lead!.id);
    expect(logged).toMatchObject({ adminId: null, body: 'Sent the welcome offer on WhatsApp.' });
    expect(sentTo('+919876543210')).toEqual([
      {
        to: '+919876543210',
        template: 'restrovia_lead_offer',
        language: 'en',
        headerImageUrl: BANNER,
        body: ['Asha Rao', 'Chai Point'],
      },
    ]);
  });

  it('does not send again when the same phone submits the form again', async () => {
    await request(app.getHttpServer())
      .post('/api/public/leads')
      .set('Origin', 'https://restrovia.shop')
      .send({ contact_name: 'Asha Rao', phone: '9876543210', consent: true })
      .expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(sentTo('+919876543210')).toHaveLength(1);
  });
});

describe('lead added in the admin panel', () => {
  it('records consent and sends the offer when the contact agreed', async () => {
    const res = await admin
      .post('/api/admin/leads')
      .set(CSRF)
      .send({
        business_name: 'Dosa Corner',
        phone: '+919811100001',
        source: 'cold_call',
        whatsapp_consent: true,
      })
      .expect(201);
    const logged = await offerActivity(res.body.id);
    expect(logged?.type).toBe('whatsapp');
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, res.body.id));
    expect(lead!.consentAt).toBeInstanceOf(Date);
    expect(sentTo('+919811100001')[0]!.body).toEqual(['there', 'Dosa Corner']);
  });

  it('sends nothing without consent, and keeps consent empty', async () => {
    const res = await admin
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ business_name: 'Idli House', phone: '+919811100002', source: 'cold_call' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 100));
    expect(sentTo('+919811100002')).toHaveLength(0);
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, res.body.id));
    expect(lead!.consentAt).toBeNull();
  });

  it('ignores consent when the lead has no phone', async () => {
    const res = await admin
      .post('/api/admin/leads')
      .set(CSRF)
      .send({ business_name: 'No Phone Cafe', source: 'cold_call', whatsapp_consent: true })
      .expect(201);
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, res.body.id));
    expect(lead!.consentAt).toBeNull();
    expect(await app.get(LeadOfferService).send(res.body.id)).toBe(false);
  });
});

describe('a failed send', () => {
  it('notes the failure on the lead and does not fail the request', async () => {
    const spy = vi
      .spyOn(whatsapp, 'sendTemplate')
      .mockRejectedValueOnce(new Error('WhatsApp answered 400: template not approved'));
    const res = await admin
      .post('/api/admin/leads')
      .set(CSRF)
      .send({
        business_name: 'Pav Bhaji Point',
        phone: '+919811100003',
        source: 'cold_call',
        whatsapp_consent: true,
      })
      .expect(201);
    let note;
    for (let i = 0; i < 50 && !note; i++) {
      note = (await activities(res.body.id)).find((a) => a.type === 'note');
      if (!note) await new Promise((r) => setTimeout(r, 20));
    }
    expect(note).toMatchObject({ body: 'The WhatsApp welcome offer could not be sent.' });
    expect(note!.meta).toMatchObject({ error: 'WhatsApp answered 400: template not approved' });
    spy.mockRestore();
  });
});
