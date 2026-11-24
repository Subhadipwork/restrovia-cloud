/** Admin locks on POS pages and settings: store, install and plan locks in the signed licence. */
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
type Pos = Awaited<ReturnType<typeof registerPos>>;
let sales: Agent;
let support: Agent;
let superAdmin: Agent;
let planId: string;

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
  const [plan] = await db
    .insert(schema.plans)
    .values({ code: 'starter_monthly', name: 'Starter', price: '799', interval: 'month' })
    .returning();
  planId = plan.id;
  superAdmin = await signIn('super_admin');
  sales = await signIn('sales');
  support = await signIn('support');
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function onStarter(pos: Pos) {
  await db
    .update(schema.subscriptions)
    .set({ status: 'cancelled' })
    .where(eq(schema.subscriptions.storeId, pos.storeId));
  await db.insert(schema.subscriptions).values({
    storeId: pos.storeId,
    planId,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 20 * DAY),
  });
}

async function policy(pos: Pos) {
  const res = await posCall(app, pos, 'POST', '/api/pos/licence', {
    pos_hash: pos.posHash,
    machine_id_hash: createHash('sha256').update(`machine:${pos.posHash}`).digest('hex'),
    app_version: '3.15.0',
  }).expect(200);
  return (
    JSON.parse(Buffer.from(res.body.token.split('.')[0], 'base64url').toString()) as LicenceClaims
  ).policy;
}

const lock = (storeId: string, body: Record<string, unknown>, agent = sales) =>
  agent.post(`/api/admin/stores/${storeId}/locks`).set(CSRF).send(body);

describe('store and install locks', () => {
  it('leaves the licence without a policy until the store gets a lock', async () => {
    const pos = await registerPos(app);
    expect(await policy(pos)).toBeUndefined();
  });

  it('signs a store lock into the licence and moves the version on', async () => {
    const pos = await registerPos(app);
    const res = await lock(pos.storeId, {
      key: 'page:/inventory',
      mode: 'hidden',
      reason: 'Payment dispute',
    }).expect(201);
    expect(await policy(pos)).toEqual({
      rev: 1,
      locks: [{ key: 'page:/inventory', mode: 'hidden', reason: 'Payment dispute' }],
    });
    const commands = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.storeId, pos.storeId));
    expect(commands.map((c) => c.type)).toContain('licence.refresh');

    await sales
      .post(`/api/admin/stores/${pos.storeId}/locks/${res.body.id}/remove`)
      .set(CSRF)
      .send({ note: 'Paid now' })
      .expect(200);
    expect(await policy(pos)).toEqual({ rev: 2, locks: [] });

    const audit = await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, pos.storeId));
    expect(audit.map((a) => a.action).sort()).toEqual(['policy.lock', 'policy.remove']);
  });

  it('gives an install lock only to that install', async () => {
    const pos = await registerPos(app);
    const second = await registerPos(app);
    const [other] = await db
      .update(schema.posDevices)
      .set({ storeId: pos.storeId, deviceName: 'Owner laptop' })
      .where(eq(schema.posDevices.id, second.posId))
      .returning();
    await lock(pos.storeId, {
      key: 'settings:*',
      reason: 'Counter PC is shared',
      pos_device_id: pos.posId,
    }).expect(201);
    await lock(pos.storeId, {
      key: 'settings:loyalty',
      reason: 'Only on the laptop',
      pos_device_id: other.id,
    }).expect(201);
    expect((await policy(pos))?.locks).toEqual([
      { key: 'settings:*', mode: 'read_only', reason: 'Counter PC is shared' },
    ]);
    const listed = await sales.get(`/api/admin/stores/${pos.storeId}/locks`).expect(200);
    expect(listed.body.locks.map((l: { device_name: string | null }) => l.device_name)).toContain(
      'Owner laptop',
    );
  });

  it('drops a lock once its end date passes', async () => {
    const pos = await registerPos(app);
    const res = await lock(pos.storeId, {
      key: 'page:/expenses',
      reason: 'Two weeks',
      ends_at: new Date(Date.now() + 14 * DAY).toISOString(),
    }).expect(201);
    expect((await policy(pos))?.locks).toHaveLength(1);
    await db
      .update(schema.storePolicyLocks)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.storePolicyLocks.id, res.body.id));
    expect((await policy(pos))?.locks).toEqual([]);
  });

  it('refuses unknown keys, store-wide unlocks per install, other stores’ installs and support', async () => {
    const pos = await registerPos(app);
    const other = await registerPos(app);
    await lock(pos.storeId, { key: 'page:/pos', reason: 'Billing is never lockable' }).expect(400);
    await lock(pos.storeId, {
      key: 'page:/inventory',
      effect: 'unlock',
      reason: 'Per install',
      pos_device_id: pos.posId,
    }).expect(400);
    await lock(pos.storeId, {
      key: 'page:/inventory',
      reason: 'Wrong store',
      pos_device_id: other.posId,
    }).expect(400);
    await support.get(`/api/admin/stores/${pos.storeId}/locks`).expect(200);
    await lock(pos.storeId, { key: 'page:/inventory', reason: 'Support' }, support).expect(403);
  });
});

describe('plan locks', () => {
  it('locks every store on the plan, minus store unlocks and owned add-ons', async () => {
    const a = await registerPos(app);
    const b = await registerPos(app);
    await onStarter(a);
    await onStarter(b);
    await superAdmin
      .patch(`/api/admin/plans/${planId}`)
      .set(CSRF)
      .send({
        locks: [
          { key: 'page:/inventory', mode: 'hidden', reason: 'Not in Starter' },
          { key: 'settings:whatsapp', mode: 'hidden', reason: 'Add-on' },
        ],
      })
      .expect(200);
    expect((await policy(a))?.locks.map((l) => l.key)).toEqual([
      'page:/inventory',
      'settings:whatsapp',
    ]);
    const [store] = await db
      .select({ rev: schema.stores.policyRev })
      .from(schema.stores)
      .where(eq(schema.stores.id, a.storeId));
    expect(store.rev).toBe(1);

    await lock(a.storeId, {
      key: 'page:/inventory',
      effect: 'unlock',
      reason: 'Friendly café',
    }).expect(201);
    expect((await policy(a))?.locks.map((l) => l.key)).toEqual(['settings:whatsapp']);

    const [whatsapp] = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.code, 'whatsapp'));
    await db.insert(schema.storeAddons).values({
      storeId: b.storeId,
      addonId: whatsapp.id,
      status: 'active',
      source: 'purchase',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 20 * DAY),
    });
    expect((await policy(b))?.locks.map((l) => l.key)).toEqual(['page:/inventory']);
  });

  it('only lets plans.manage change plan locks, and refuses unknown keys', async () => {
    await sales.patch(`/api/admin/plans/${planId}`).set(CSRF).send({ locks: [] }).expect(403);
    await superAdmin
      .patch(`/api/admin/plans/${planId}`)
      .set(CSRF)
      .send({ locks: [{ key: 'page:/pos', mode: 'hidden', reason: 'No' }] })
      .expect(400);
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'plan.update'),
          eq(schema.adminAuditLog.targetId, planId),
        ),
      );
    expect(audit.length).toBeGreaterThan(0);
  });
});
