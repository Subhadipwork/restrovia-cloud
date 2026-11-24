/** Marketplace add-ons: the admin catalogue, store add-ons, and the features they put in licences. */
import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS, type LicenceClaims, type SystemRoleKey } from '@restrovia/shared';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { createTestApp, posCall, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const CSRF = { 'X-Restrovia-Admin': '1' };
const DAY = 86_400_000;
type Agent = ReturnType<typeof request.agent>;
let sales: Agent;
let support: Agent;
let superAdmin: Agent;

async function signIn(role: SystemRoleKey): Promise<Agent> {
  const password = 'correct horse battery';
  const email = `${role}-${randomUUID().slice(0, 8)}@restrovia.test`;
  await db.insert(schema.admins).values({
    name: `Test ${role}`,
    email,
    roleId: SYSTEM_ROLE_IDS[role],
    passwordHash: await app.get(CryptoService).hashPassword(password),
  });
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/admin/auth/login').set(CSRF).send({ email, password }).expect(200);
  return agent;
}

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  app = await createTestApp(url);
  await db.insert(schema.plans).values([
    { code: 'starter_monthly', name: 'Starter', price: '799.00', interval: 'month' },
    {
      code: 'growth_monthly',
      name: 'Growth',
      price: '1499.00',
      interval: 'month',
      features: { kiosk: true },
    },
  ]);
  superAdmin = await signIn('super_admin');
  sales = await signIn('sales');
  support = await signIn('support');
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

function createAddon(body: Record<string, unknown>, agent = superAdmin) {
  return agent.post('/api/admin/addons').set(CSRF).send(body);
}

async function storeOnPlan(planCode: string) {
  const pos = await registerPos(app);
  const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.code, planCode));
  await db
    .update(schema.subscriptions)
    .set({ status: 'cancelled' })
    .where(eq(schema.subscriptions.storeId, pos.storeId));
  await db.insert(schema.subscriptions).values({
    storeId: pos.storeId,
    planId: plan.id,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 20 * DAY),
  });
  return pos;
}

async function licenceFeatures(pos: Awaited<ReturnType<typeof registerPos>>) {
  const res = await posCall(app, pos, 'POST', '/api/pos/licence', {
    pos_hash: pos.posHash,
    machine_id_hash: createHash('sha256').update(`machine:${pos.posHash}`).digest('hex'),
    app_version: '3.15.0',
  }).expect(200);
  const claims = JSON.parse(
    Buffer.from(res.body.token.split('.')[0], 'base64url').toString(),
  ) as LicenceClaims;
  return claims.features;
}

const addTo = (storeId: string, body: Record<string, unknown>, agent = sales) =>
  agent.post(`/api/admin/stores/${storeId}/addons`).set(CSRF).send(body);

describe('catalogue', () => {
  beforeAll(async () => {
    await createAddon({
      code: 'whatsapp',
      name: 'WhatsApp delivery',
      category: 'channels',
      kind: 'paid',
      price: '499',
      interval: 'month',
      trial_days: 14,
      status: 'live',
    }).expect(201);
    await createAddon({
      code: 'tableside',
      name: 'Tableside Ordering',
      category: 'operations',
      kind: 'free',
      status: 'live',
    }).expect(201);
  });

  it('lists add-ons with defaults filled in', async () => {
    const res = await superAdmin.get('/api/admin/addons').expect(200);
    const tableside = res.body.find((a: { code: string }) => a.code === 'tableside');
    expect(tableside).toMatchObject({
      interval: 'none',
      unit: 'outlet',
      scope: 'pos',
      price: '0.00',
      active_stores: 0,
    });
  });

  it('refuses a code in use, a bad code and an unknown required add-on', async () => {
    await createAddon({
      code: 'whatsapp',
      name: 'Again',
      category: 'channels',
      kind: 'free',
    }).expect(409);
    await createAddon({ code: 'Bad Code', name: 'x', category: 'channels', kind: 'free' }).expect(
      400,
    );
    await createAddon({
      code: 'review_qr',
      name: 'Review QR',
      category: 'marketing',
      kind: 'paid',
      requires: ['google_profile'],
    }).expect(400);
  });

  it('keeps the code fixed, audits changes, and hides retired add-ons by default', async () => {
    const created = await createAddon({
      code: 'old_thing',
      name: 'Old thing',
      category: 'services',
      kind: 'contact',
    }).expect(201);
    await superAdmin
      .patch(`/api/admin/addons/${created.body.id}`)
      .set(CSRF)
      .send({ code: 'renamed' })
      .expect(400);
    await superAdmin
      .patch(`/api/admin/addons/${created.body.id}`)
      .set(CSRF)
      .send({ status: 'retired', price: '10' })
      .expect(200);
    const visible = await superAdmin.get('/api/admin/addons').expect(200);
    expect(visible.body.map((a: { code: string }) => a.code)).not.toContain('old_thing');
    const all = await superAdmin.get('/api/admin/addons?include_retired=true').expect(200);
    expect(all.body.map((a: { code: string }) => a.code)).toContain('old_thing');
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'addon.update'),
          eq(schema.adminAuditLog.targetId, created.body.id),
        ),
      );
    expect(audit[0].details).toMatchObject({
      changes: { status: 'retired', price: '10' },
      before: { status: 'draft', price: '0.00' },
    });
  });

  it('lets sales read the catalogue but not change it; support sees neither', async () => {
    await sales.get('/api/admin/addons').expect(200);
    await createAddon(
      { code: 'nope', name: 'x', category: 'channels', kind: 'free' },
      sales,
    ).expect(403);
    await support.get('/api/admin/addons').expect(403);
  });
});

describe('store add-ons and licences', () => {
  it('adds a paid add-on to the plan features in the licence and asks the POS to refresh', async () => {
    const pos = await storeOnPlan('growth_monthly');
    expect(await licenceFeatures(pos)).toEqual(['kiosk']);

    const res = await addTo(pos.storeId, {
      action: 'grant',
      addon_code: 'whatsapp',
      source: 'purchase',
      amount: '499',
      note: 'Paid by UPI',
    }).expect(201);
    expect(res.body.status).toBe('active');
    const end = new Date(res.body.current_period_end);
    expect(end.getTime() - Date.now()).toBeGreaterThan(27 * DAY);

    expect(await licenceFeatures(pos)).toEqual(['whatsapp', 'kiosk']);
    const commands = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.storeId, pos.storeId));
    expect(commands.map((c) => c.type)).toContain('licence.refresh');

    const list = await sales.get(`/api/admin/stores/${pos.storeId}/addons`).expect(200);
    expect(list.body[0]).toMatchObject({
      addon_code: 'whatsapp',
      in_use: true,
      price: '499.00',
      payments: [{ amount: '499.00', method: 'manual' }],
    });
  });

  it('gives a free add-on that never ends and refuses adding it twice', async () => {
    const pos = await storeOnPlan('starter_monthly');
    expect(await licenceFeatures(pos)).toEqual([]);
    const res = await addTo(pos.storeId, {
      action: 'grant',
      addon_code: 'tableside',
      note: 'Free add-on',
    }).expect(201);
    expect(res.body.current_period_end).toBeNull();
    expect(await licenceFeatures(pos)).toEqual(['tableside']);
    await addTo(pos.storeId, {
      action: 'grant',
      addon_code: 'tableside',
      note: 'Again',
    }).expect(409);
  });

  it('starts one trial per store per add-on', async () => {
    const pos = await storeOnPlan('starter_monthly');
    const trial = await addTo(pos.storeId, { action: 'trial', addon_code: 'whatsapp' }).expect(201);
    expect(trial.body.status).toBe('trial');
    expect(await licenceFeatures(pos)).toEqual(['whatsapp']);
    await addTo(pos.storeId, { action: 'trial', addon_code: 'tableside' }).expect(409);

    await db
      .update(schema.storeAddons)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(schema.storeAddons.id, trial.body.id));
    expect(await licenceFeatures(pos)).toEqual([]);
    const again = await addTo(pos.storeId, { action: 'trial', addon_code: 'whatsapp' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('addon_trial_used');
  });

  it('extends from the current end on payment, even after a lapse', async () => {
    const pos = await storeOnPlan('starter_monthly');
    const granted = await addTo(pos.storeId, {
      action: 'grant',
      addon_code: 'whatsapp',
      note: 'First month',
    }).expect(201);
    const firstEnd = new Date(granted.body.current_period_end);
    const paid = await sales
      .post(`/api/admin/stores/${pos.storeId}/addons/${granted.body.id}/payments`)
      .set(CSRF)
      .send({ amount: '499' })
      .expect(201);
    const secondEnd = new Date(paid.body.current_period_end);
    expect(secondEnd.getTime() - firstEnd.getTime()).toBeGreaterThan(27 * DAY);

    await db
      .update(schema.storeAddons)
      .set({ currentPeriodEnd: new Date(Date.now() - DAY) })
      .where(eq(schema.storeAddons.id, granted.body.id));
    expect(await licenceFeatures(pos)).toEqual([]);
    const renewed = await sales
      .post(`/api/admin/stores/${pos.storeId}/addons/${granted.body.id}/payments`)
      .set(CSRF)
      .send({ amount: '499' })
      .expect(201);
    expect(new Date(renewed.body.current_period_end).getTime()).toBeGreaterThan(Date.now());
    expect(await licenceFeatures(pos)).toEqual(['whatsapp']);
  });

  it('refuses renewing an add-on that never ends', async () => {
    const pos = await storeOnPlan('starter_monthly');
    const granted = await addTo(pos.storeId, {
      action: 'grant',
      addon_code: 'tableside',
      note: 'Free',
    }).expect(201);
    const res = await sales
      .post(`/api/admin/stores/${pos.storeId}/addons/${granted.body.id}/payments`)
      .set(CSRF)
      .send({ amount: '0' });
    expect(res.status).toBe(409);
  });

  it('cancels to the period end, or stops at once', async () => {
    const pos = await storeOnPlan('starter_monthly');
    const granted = await addTo(pos.storeId, {
      action: 'grant',
      addon_code: 'whatsapp',
      note: 'Month',
    }).expect(201);
    const cancelled = await sales
      .post(`/api/admin/stores/${pos.storeId}/addons/${granted.body.id}/revoke`)
      .set(CSRF)
      .send({ note: 'Owner asked to stop' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(await licenceFeatures(pos)).toEqual(['whatsapp']);

    const stopped = await sales
      .post(`/api/admin/stores/${pos.storeId}/addons/${granted.body.id}/revoke`)
      .set(CSRF)
      .send({ immediate: true, note: 'Refunded' })
      .expect(200);
    expect(stopped.body.status).toBe('revoked');
    expect(await licenceFeatures(pos)).toEqual([]);
    await sales
      .post(`/api/admin/stores/${pos.storeId}/addons/${granted.body.id}/revoke`)
      .set(CSRF)
      .send({ immediate: true, note: 'Again' })
      .expect(409);

    const audit = await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, pos.storeId));
    expect(audit.map((a) => a.action).sort()).toEqual([
      'store_addon.grant',
      'store_addon.revoke',
      'store_addon.revoke',
    ]);
  });

  it('leaves a store without a plan unrestricted, whatever add-ons it has', async () => {
    const pos = await registerPos(app);
    await addTo(pos.storeId, { action: 'grant', addon_code: 'tableside', note: 'Free' }).expect(
      201,
    );
    expect(await licenceFeatures(pos)).toBeUndefined();
  });

  it('refuses a payment for another store’s add-on, and support changing add-ons', async () => {
    const a = await storeOnPlan('starter_monthly');
    const b = await storeOnPlan('starter_monthly');
    const granted = await addTo(a.storeId, {
      action: 'grant',
      addon_code: 'whatsapp',
      note: 'Month',
    }).expect(201);
    await sales
      .post(`/api/admin/stores/${b.storeId}/addons/${granted.body.id}/payments`)
      .set(CSRF)
      .send({ amount: '499' })
      .expect(404);
    await support.get(`/api/admin/stores/${a.storeId}/addons`).expect(200);
    await addTo(a.storeId, { action: 'trial', addon_code: 'tableside' }, support).expect(403);
  });
});
