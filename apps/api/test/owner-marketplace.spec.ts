/** The owner portal Marketplace: adding, trials, requests to buy, cancelling and reminders. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
import { AddonRemindersService } from '../src/addons/addon-reminders.service.js';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { EmailService } from '../src/email/email.service.js';
import { createTestApp, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let email: EmailService;
let sales: ReturnType<typeof request.agent>;

const OWNER_CSRF = { 'X-Restrovia-Owner': '1' };
const ADMIN_CSRF = { 'X-Restrovia-Admin': '1' };
const PASSWORD = 'tea garden 42';
const DAY = 86_400_000;
const SALES_INBOX = 'sales@restrovia.test';

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  process.env.LEADS_NOTIFY_EMAIL = SALES_INBOX;
  app = await createTestApp(url);
  email = app.get(EmailService);
  await db.update(schema.addons).set({ status: 'live' }).where(eq(schema.addons.code, 'kiosk'));

  const adminEmail = `sales-${randomUUID().slice(0, 8)}@restrovia.test`;
  await db.insert(schema.admins).values({
    name: 'Sales',
    email: adminEmail,
    roleId: SYSTEM_ROLE_IDS.sales,
    passwordHash: await app.get(CryptoService).hashPassword(PASSWORD),
  });
  sales = request.agent(app.getHttpServer());
  await sales
    .post('/api/admin/auth/login')
    .set(ADMIN_CSRF)
    .send({ email: adminEmail, password: PASSWORD })
    .expect(200);
});

afterAll(async () => {
  delete process.env.LEADS_NOTIFY_EMAIL;
  await app?.close();
  await pool?.end();
});

async function ownerOf(storeId: string, role: 'owner' | 'manager' = 'owner') {
  const [owner] = await db
    .insert(schema.owners)
    .values({
      name: 'Asha',
      email: `owner-${randomUUID().slice(0, 8)}@restrovia.test`,
      passwordHash: await app.get(CryptoService).hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    })
    .returning();
  await db.insert(schema.storeMembers).values({ storeId, ownerId: owner.id, role });
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/owner/auth/login')
    .set(OWNER_CSRF)
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  return { agent, owner };
}

async function cafe() {
  const pos = await registerPos(app);
  const owner = await ownerOf(pos.storeId);
  const base = `/api/owner/stores/${pos.storeId}/marketplace`;
  const as = owner.agent;
  return {
    pos,
    owner,
    base,
    list: async () => (await as.get(base).expect(200)).body,
    post: (path: string, body: object = {}) => as.post(`${base}${path}`).set(OWNER_CSRF).send(body),
  };
}

const byCode = (body: { addons: { code: string }[] }, code: string) =>
  body.addons.find((a) => a.code === code) as Record<string, unknown>;

describe('owner portal Marketplace', () => {
  it('lists the catalogue with the café’s state', async () => {
    const c = await cafe();
    const body = await c.list();
    expect(body.role).toBe('owner');
    expect(byCode(body, 'whatsapp')).toMatchObject({
      state: 'available',
      can_start_trial: true,
      can_request: true,
      pending_request: null,
    });
    expect(byCode(body, 'tableside')).toMatchObject({ can_add_free: true, can_request: false });
    expect(body.mine).toEqual([]);
  });

  it('adds a free add-on and starts a trial, as the owner only', async () => {
    const c = await cafe();
    await c.post('/addons/tableside/add', { mode: 'free' }).expect(200);
    await c.post('/addons/whatsapp/add', { mode: 'trial' }).expect(200);
    await c.post('/addons/whatsapp/add', { mode: 'free' }).expect(409);
    const body = await c.list();
    expect(byCode(body, 'whatsapp')).toMatchObject({ state: 'trial', can_start_trial: false });
    expect(body.mine.map((m: { addon_code: string }) => m.addon_code).sort()).toEqual([
      'tableside',
      'whatsapp',
    ]);
    const commands = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.storeId, c.pos.storeId));
    expect(commands.some((cmd) => cmd.type === 'licence.refresh')).toBe(true);

    const manager = await ownerOf(c.pos.storeId, 'manager');
    await manager.agent
      .post(`${c.base}/addons/kiosk/add`)
      .set(OWNER_CSRF)
      .send({ mode: 'trial' })
      .expect(403);
    expect((await manager.agent.get(c.base).expect(200)).body.role).toBe('manager');
  });

  it('lets a manager request a paid add-on, one pending at a time, and tells sales', async () => {
    const c = await cafe();
    const manager = await ownerOf(c.pos.storeId, 'manager');
    const before = email.outbox.length;
    const res = await manager.agent
      .post(`${c.base}/addons/kiosk/request`)
      .set(OWNER_CSRF)
      .send({ quantity: 2, note: 'Two counters' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'pending', quantity: 2 });
    await c.post('/addons/kiosk/request', {}).expect(409);
    await c.post('/addons/tableside/request', {}).expect(409);

    const mail = email.outbox.slice(before).find((m) => m.to === SALES_INBOX);
    expect(mail?.subject).toContain('Self-order kiosk');
    expect(mail?.text).toContain('Two counters');

    const whatsapp = await c.post('/addons/whatsapp/request', { quantity: 5 }).expect(201);
    expect(whatsapp.body.quantity).toBe(1);

    const body = await c.list();
    expect(byCode(body, 'kiosk')).toMatchObject({ can_request: false });
    expect(body.requests).toHaveLength(2);
  });

  it('closes the request when Restrovia adds the add-on, and tells the owner', async () => {
    const c = await cafe();
    const req = await c.post('/addons/whatsapp/request', { note: 'Please' }).expect(201);
    const pending = await sales
      .get(`/api/admin/addon-requests?store_id=${c.pos.storeId}`)
      .expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      addon_code: 'whatsapp',
      requested_by: c.owner.owner.email,
    });

    const before = email.outbox.length;
    await sales
      .post(`/api/admin/stores/${c.pos.storeId}/addons`)
      .set(ADMIN_CSRF)
      .send({
        action: 'grant',
        addon_code: 'whatsapp',
        source: 'purchase',
        quantity: 1,
        amount: '499',
        note: 'Paid by UPI',
      })
      .expect(201);
    const [row] = await db
      .select()
      .from(schema.addonRequests)
      .where(eq(schema.addonRequests.id, req.body.id));
    expect(row.status).toBe('done');
    expect(email.outbox.slice(before).some((m) => m.to === c.owner.owner.email)).toBe(true);

    const body = await c.list();
    const mine = body.mine.find((m: { addon_code: string }) => m.addon_code === 'whatsapp');
    expect(mine).toMatchObject({ status: 'active', can_cancel: true });
    expect(mine.payments).toEqual([expect.objectContaining({ amount: '499.00' })]);
  });

  it('lets Restrovia decline and the café cancel its own request', async () => {
    const c = await cafe();
    const kiosk = await c.post('/addons/kiosk/request', {}).expect(201);
    await sales
      .post(`/api/admin/stores/${c.pos.storeId}/addon-requests/${kiosk.body.id}/decline`)
      .set(ADMIN_CSRF)
      .send({ note: 'Kiosk needs version 3.15' })
      .expect(200);
    const whatsapp = await c.post('/addons/whatsapp/request', {}).expect(201);
    await c.post(`/requests/${whatsapp.body.id}/cancel`).expect(200);
    await c.post(`/requests/${whatsapp.body.id}/cancel`).expect(404);

    const body = await c.list();
    expect(
      body.requests.map((r: { addon_code: string; status: string }) => [r.addon_code, r.status]),
    ).toEqual([
      ['whatsapp', 'cancelled'],
      ['kiosk', 'declined'],
    ]);
    const audit = await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, c.pos.storeId));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'addon_request.create',
        'addon_request.decline',
        'addon_request.cancel',
      ]),
    );
  });

  it('cancels: a trial stops now, a paid add-on runs to its end, a kept-free one needs Restrovia', async () => {
    const c = await cafe();
    await c.post('/addons/whatsapp/add', { mode: 'trial' }).expect(200);
    let mine = (await c.list()).mine;
    await c.post(`/mine/${mine[0].id}/cancel`).expect(200);
    expect((await c.list()).mine).toEqual([]);

    const [kiosk] = await db.select().from(schema.addons).where(eq(schema.addons.code, 'kiosk'));
    const [paid] = await db
      .insert(schema.storeAddons)
      .values({
        storeId: c.pos.storeId,
        addonId: kiosk.id,
        status: 'active',
        source: 'purchase',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 20 * DAY),
      })
      .returning();
    const res = await c.post(`/mine/${paid.id}/cancel`).expect(200);
    expect(res.body.status).toBe('cancelled');
    expect(new Date(res.body.ends_at).getTime()).toBe(paid.currentPeriodEnd!.getTime());
    await c.post(`/mine/${paid.id}/cancel`).expect(409);

    const [tableside] = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.code, 'tableside'));
    const [kept] = await db
      .insert(schema.storeAddons)
      .values({
        storeId: c.pos.storeId,
        addonId: tableside.id,
        status: 'active',
        source: 'grandfathered',
        currentPeriodStart: new Date(),
      })
      .returning();
    await c.post(`/mine/${kept.id}/cancel`).expect(409);
    mine = (await c.list()).mine;
    expect(mine.find((m: { id: string }) => m.id === kept.id).can_cancel).toBe(false);
  });

  it('keeps other cafés’ requests and add-ons out of reach', async () => {
    const a = await cafe();
    const b = await cafe();
    const req = await a.post('/addons/whatsapp/request', {}).expect(201);
    await b.post(`/requests/${req.body.id}/cancel`).expect(404);
    await b.owner.agent.get(a.base).expect(404);
  });
});

describe('add-on reminders', () => {
  it('emails owners once per end date: trials 3 days ahead, paid periods 7 days ahead', async () => {
    const c = await cafe();
    const [whatsapp] = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.code, 'whatsapp'));
    const [kiosk] = await db.select().from(schema.addons).where(eq(schema.addons.code, 'kiosk'));
    const [trial] = await db
      .insert(schema.storeAddons)
      .values({
        storeId: c.pos.storeId,
        addonId: whatsapp.id,
        status: 'trial',
        source: 'purchase',
        trialEndsAt: new Date(Date.now() + 5 * DAY),
      })
      .returning();
    await db.insert(schema.storeAddons).values({
      storeId: c.pos.storeId,
      addonId: kiosk.id,
      status: 'active',
      source: 'purchase',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 6 * DAY),
    });
    const reminders = app.get(AddonRemindersService);
    const to = c.owner.owner.email;
    const sentTo = (from: number) => email.outbox.slice(from).filter((m) => m.to === to);

    let before = email.outbox.length;
    await reminders.sendReminders();
    expect(sentTo(before).map((m) => m.subject)).toEqual([
      expect.stringContaining('Self-order kiosk ends on'),
    ]);

    before = email.outbox.length;
    await reminders.sendReminders();
    expect(sentTo(before)).toEqual([]);

    await db
      .update(schema.storeAddons)
      .set({ trialEndsAt: new Date(Date.now() + 2 * DAY) })
      .where(eq(schema.storeAddons.id, trial.id));
    before = email.outbox.length;
    await reminders.sendReminders();
    expect(sentTo(before).map((m) => m.subject)).toEqual([
      expect.stringContaining('WhatsApp delivery trial ends on'),
    ]);

    const [row] = await db
      .select()
      .from(schema.storeAddons)
      .where(and(eq(schema.storeAddons.id, trial.id)));
    expect(row.remindedFor?.getTime()).toBe(row.trialEndsAt?.getTime());
  });
});
