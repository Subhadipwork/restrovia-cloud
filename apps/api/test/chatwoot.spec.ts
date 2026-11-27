/** The Chatwoot webhook: a new WhatsApp conversation becomes a lead. */
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import * as schema from '../src/db/schema/index.js';
import { createTestApp, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
const token = randomBytes(32).toString('hex');
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

/** The shape Chatwoot sends, trimmed to what matters. */
const event = (phone: string, name = 'Asha Rao', extra: Record<string, unknown> = {}) => ({
  event: 'automation_event.conversation_created',
  channel: 'Channel::Whatsapp',
  contact_inbox: { source_id: phone.replace('+', '') },
  meta: { sender: { name, phone_number: phone } },
  messages: [{ id: 56, content: 'Hi!', message_type: 1 }],
  ...extra,
});
const post = (body: object, secret = token) =>
  request(app.getHttpServer()).post(`/api/public/chatwoot?token=${secret}`).send(body);
const byPhone = (phone: string) =>
  db.select().from(schema.leads).where(eq(schema.leads.phoneE164, phone));

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.CHATWOOT_WEBHOOK_TOKEN = token;
  app = await createTestApp(url);
});

afterAll(async () => {
  delete process.env.CHATWOOT_WEBHOOK_TOKEN;
  await app?.close();
  await pool?.end();
});

describe('Chatwoot webhook', () => {
  it('refuses a wrong or missing secret', async () => {
    await post(event('+919800000001'), 'wrong').expect(401);
    await request(app.getHttpServer())
      .post('/api/public/chatwoot')
      .send(event('+919800000001'))
      .expect(401);
    expect(await byPhone('+919800000001')).toHaveLength(0);
  });

  it('creates a lead with its timeline entry and audit row', async () => {
    const res = await post(event('+919800000002')).expect(200);
    expect(res.body).toEqual({ status: 'Success!' });
    const [lead] = await byPhone('+919800000002');
    expect(lead).toMatchObject({
      businessName: 'Asha Rao',
      contactName: 'Asha Rao',
      source: 'whatsapp',
      stage: 'new',
      assignedAdminId: null,
      consentAt: null,
    });
    const activities = await db
      .select()
      .from(schema.leadActivities)
      .where(eq(schema.leadActivities.leadId, lead!.id));
    expect(activities.map((a) => a.type)).toEqual(['created']);
    const audits = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, lead!.id));
    expect(audits.map((a) => a.action)).toEqual(['lead.create']);
  });

  it('accepts the account webhook event and titles a nameless lead by its number', async () => {
    await post(event('+919800000003', '+91 98000 00003', { event: 'conversation_created' })).expect(
      200,
    );
    const [lead] = await byPhone('+919800000003');
    expect(lead).toMatchObject({ businessName: 'WhatsApp +919800000003', contactName: null });
  });

  it('makes one lead when events for a number repeat or arrive together', async () => {
    await Promise.all([1, 2, 3, 4].map(() => post(event('+919800000004')).expect(200)));
    await post(event('+919800000004', 'Another Name')).expect(200);
    const rows = await byPhone('+919800000004');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactName).toBe('Asha Rao');
  });

  it('keeps a won lead as it is and opens a new one after a lost lead', async () => {
    await db.insert(schema.leads).values([
      { businessName: 'Won', phoneE164: '+919800000005', source: 'website', stage: 'won' },
      {
        businessName: 'Lost',
        phoneE164: '+919800000006',
        source: 'website',
        stage: 'lost',
        lostReason: 'price',
      },
    ]);
    await post(event('+919800000005')).expect(200);
    await post(event('+919800000006')).expect(200);
    expect(await byPhone('+919800000005')).toHaveLength(1);
    expect(await byPhone('+919800000006')).toHaveLength(2);
  });

  it('answers success but saves nothing for events it does not use', async () => {
    const before = (await db.select().from(schema.leads)).length;
    await post(event('+919800000007', 'A', { event: 'message_created' })).expect(200);
    await post(event('+919800000007', 'A', { channel: 'Channel::WebWidget' })).expect(200);
    await post({ event: 'conversation_created', channel: 'Channel::Whatsapp' }).expect(200);
    expect(await db.select().from(schema.leads)).toHaveLength(before);
  });
});
