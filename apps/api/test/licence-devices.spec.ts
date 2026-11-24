/** One trial per computer, and moving a POS to its café: admin Move and owner link codes. */
import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import {
  createTestApp,
  eventsBody,
  orderEvent,
  orderSnapshot,
  posCall,
  registerPos,
  resetDatabase,
  testDatabaseUrl,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const ADMIN_CSRF = { 'X-Restrovia-Admin': '1' };
const OWNER_CSRF = { 'X-Restrovia-Owner': '1' };
const PASSWORD = 'tea garden 42';
const DAY = 86_400_000;

type Pos = Awaited<ReturnType<typeof registerPos>>;

const computer = () => createHash('sha256').update(`machine:${randomUUID()}`).digest('hex');

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  await db
    .insert(schema.plans)
    .values({ code: 'outlet_yearly', name: 'Outlet yearly', price: '9999.00', interval: 'year' });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const checkIn = (pos: Pos, machine: string) =>
  posCall(app, pos, 'POST', '/api/pos/licence', {
    pos_hash: pos.posHash,
    machine_id_hash: machine,
    app_version: '3.15.0',
  });

const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as Record<string, string>;

const storeOf = (id: string) => db.query.stores.findFirst({ where: eq(schema.stores.id, id) });

async function activatePlan(storeId: string) {
  const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.code, 'outlet_yearly'));
  await db
    .update(schema.subscriptions)
    .set({ status: 'cancelled' })
    .where(eq(schema.subscriptions.storeId, storeId));
  const end = new Date(Date.now() + 300 * DAY);
  await db.insert(schema.subscriptions).values({
    storeId,
    planId: plan.id,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: end,
  });
  return end;
}

async function adminAgent(role: 'support' | 'super_admin' = 'support') {
  const crypto = app.get(CryptoService);
  const [admin] = await db
    .insert(schema.admins)
    .values({
      name: 'Support',
      email: `support-${randomUUID().slice(0, 8)}@restrovia.test`,
      roleId: SYSTEM_ROLE_IDS[role],
      passwordHash: await crypto.hashPassword(PASSWORD),
    })
    .returning();
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/admin/auth/login')
    .set(ADMIN_CSRF)
    .send({ email: admin.email, password: PASSWORD })
    .expect(200);
  return agent;
}

async function ownerOf(storeId: string, role: 'owner' | 'manager' = 'owner') {
  const crypto = app.get(CryptoService);
  const [owner] = await db
    .insert(schema.owners)
    .values({
      name: 'Asha',
      email: `owner-${randomUUID().slice(0, 8)}@restrovia.test`,
      passwordHash: await crypto.hashPassword(PASSWORD),
    })
    .returning();
  await db.insert(schema.storeMembers).values({ storeId, ownerId: owner.id, role });
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/owner/auth/login')
    .set(OWNER_CSRF)
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  return { owner, agent };
}

const linkCode = async (pos: Pos, machine: string) =>
  (await posCall(app, pos, 'POST', '/api/pos/link-code', { machine_id_hash: machine }).expect(200))
    .body.code as string;

const sendOrder = (pos: Pos, id: number, total: number) =>
  posCall(
    app,
    pos,
    'POST',
    '/api/pos/events',
    eventsBody(pos, [orderEvent(orderSnapshot(id, { total }))]),
  ).expect(200);

describe('one trial per computer', () => {
  it('gives the first store on a computer its trial and keeps it', async () => {
    const machine = computer();
    const first = await registerPos(app);
    const res = await checkIn(first, machine).expect(200);
    expect(claimsOf(res.body.token).status).toBe('trial');
    const known = await db.query.machineTrials.findFirst({
      where: eq(schema.machineTrials.machineIdHash, machine),
    });
    expect(known?.storeId).toBe(first.storeId);
  });

  it('makes a reinstall on the same computer wait for activation, with no trial', async () => {
    const machine = computer();
    const first = await registerPos(app);
    await checkIn(first, machine).expect(200);

    const reinstall = await registerPos(app);
    const res = await checkIn(reinstall, machine).expect(202);
    expect(res.body).toEqual({
      status: 'activation_pending',
      store_code: reinstall.storeId.replace(/-/g, '').slice(0, 8).toUpperCase(),
    });
    const store = await storeOf(reinstall.storeId);
    expect(store).toMatchObject({ activation: 'pending', suggestedStoreId: first.storeId });
    const [trial] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.storeId, reinstall.storeId));
    expect(trial.status).toBe('cancelled');
    // Later check-ins keep waiting; the first store is unaffected.
    await checkIn(reinstall, machine).expect(202);
    await checkIn(first, machine).expect(200);
  });

  it('still makes the reinstall wait after the first store was deleted', async () => {
    const machine = computer();
    const first = await registerPos(app);
    await checkIn(first, machine).expect(200);
    await db
      .update(schema.stores)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(schema.stores.id, first.storeId));

    const reinstall = await registerPos(app);
    await checkIn(reinstall, machine).expect(202);
    expect((await storeOf(reinstall.storeId))?.suggestedStoreId).toBeNull();
  });

  it('leaves a plan an admin set up before the first check-in alone', async () => {
    const machine = computer();
    await checkIn(await registerPos(app), machine).expect(200);
    const second = await registerPos(app);
    await activatePlan(second.storeId);
    const res = await checkIn(second, machine).expect(200);
    expect(claimsOf(res.body.token).status).toBe('active');
    expect((await storeOf(second.storeId))?.activation).toBe('active');
  });

  it('starts only one trial when two installs on one computer check in at once', async () => {
    const machine = computer();
    const a = await registerPos(app);
    const b = await registerPos(app);
    const results = await Promise.all([checkIn(a, machine), checkIn(b, machine)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 202]);
  });

  it('gives a paid store moved to a new computer by Reset binding no pending state', async () => {
    const pos = await registerPos(app);
    await checkIn(pos, computer()).expect(200);
    await activatePlan(pos.storeId);
    await db
      .update(schema.posDevices)
      .set({ machineIdHash: null })
      .where(eq(schema.posDevices.id, pos.posId));
    const res = await checkIn(pos, computer()).expect(200);
    expect(claimsOf(res.body.token).status).toBe('active');
  });

  it('lets an admin start a trial for a pending store, such as a resold computer', async () => {
    const machine = computer();
    await checkIn(await registerPos(app), machine).expect(200);
    const resold = await registerPos(app);
    await checkIn(resold, machine).expect(202);

    const agent = await adminAgent('super_admin');
    const pending = await agent.get('/api/admin/stores?activation=pending').expect(200);
    expect(pending.body.data.map((s: { id: string }) => s.id)).toContain(resold.storeId);
    const detail = await agent.get(`/api/admin/stores/${resold.storeId}`).expect(200);
    expect(detail.body.suggested_store).not.toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    const dashboard = await agent
      .get('/api/admin/overview/dashboard')
      .query({ from: today, to: today })
      .expect(200);
    expect(dashboard.body.live.pending_activation).toBeGreaterThan(0);

    await agent
      .post(`/api/admin/stores/${resold.storeId}/licence`)
      .set(ADMIN_CSRF)
      .send({ action: 'extend_trial', days: 30 })
      .expect(200);
    const res = await checkIn(resold, machine).expect(200);
    expect(claimsOf(res.body.token).status).toBe('trial');
    expect((await storeOf(resold.storeId))?.activation).toBe('active');
  });
});

describe('orders from two computers of one store', () => {
  it('keeps both when their POS order ids are the same', async () => {
    const paid = await registerPos(app);
    const [twoTills] = await db
      .insert(schema.plans)
      .values({
        code: `two_tills_${randomUUID().slice(0, 8)}`,
        name: 'Two tills',
        price: '1999.00',
        interval: 'month',
        maxDevices: 2,
      })
      .returning();
    await db
      .update(schema.subscriptions)
      .set({
        planId: twoTills.id,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      })
      .where(eq(schema.subscriptions.storeId, paid.storeId));
    await sendOrder(paid, 1, 100);
    const fresh = await registerPos(app);
    await sendOrder(fresh, 1, 200);

    const agent = await adminAgent();
    await agent
      .post(`/api/admin/stores/${fresh.storeId}/devices/${fresh.posId}/move`)
      .set(ADMIN_CSRF)
      .send({ target_store_id: paid.storeId })
      .expect(200);
    await sendOrder(fresh, 1, 250);

    const rows = await db
      .select({ device: schema.orders.deviceId, total: schema.orders.total })
      .from(schema.orders)
      .where(eq(schema.orders.storeId, paid.storeId));
    expect(rows.map((r) => [r.device, r.total]).sort()).toEqual(
      [
        [paid.posId, '100.00'],
        [fresh.posId, '250.00'],
      ].sort(),
    );
  });
});

describe('admin Move to existing store', () => {
  it('moves a reinstall into its store, keeping the plan, and retires the old install', async () => {
    const machine = computer();
    const original = await registerPos(app);
    await checkIn(original, machine).expect(200);
    const end = await activatePlan(original.storeId);
    const reinstall = await registerPos(app);
    await checkIn(reinstall, machine).expect(202);
    await sendOrder(reinstall, 7, 90);

    const agent = await adminAgent();
    const res = await agent
      .post(`/api/admin/stores/${reinstall.storeId}/devices/${reinstall.posId}/move`)
      .set(ADMIN_CSRF)
      .send({ target_store_id: original.storeId })
      .expect(200);
    expect(res.body).toEqual({
      device_id: reinstall.posId,
      store_id: original.storeId,
      retired_device_id: original.posId,
      removed_store_id: reinstall.storeId,
    });

    const claims = claimsOf((await checkIn(reinstall, machine).expect(200)).body.token);
    expect(claims).toMatchObject({ store_id: original.storeId, status: 'active' });
    expect(Date.parse(claims.ends_at)).toBe(end.getTime());
    await checkIn(original, machine).expect(410);
    expect((await storeOf(reinstall.storeId))?.status).toBe('deleted');
    const moved = await db.query.orders.findFirst({
      where: eq(schema.orders.deviceId, reinstall.posId),
    });
    expect(moved?.storeId).toBe(original.storeId);
    const audit = await db.query.adminAuditLog.findFirst({
      where: eq(schema.adminAuditLog.targetId, reinstall.posId),
    });
    expect(audit?.action).toBe('device.moved');
  });

  it('refuses a target store that does not exist', async () => {
    const pos = await registerPos(app);
    const agent = await adminAgent();
    await agent
      .post(`/api/admin/stores/${pos.storeId}/devices/${pos.posId}/move`)
      .set(ADMIN_CSRF)
      .send({ target_store_id: randomUUID() })
      .expect(404);
  });
});

describe('owner link codes', () => {
  it('moves a new computer into the owner’s café and switches the old one off', async () => {
    const oldComputer = computer();
    const paid = await registerPos(app);
    await checkIn(paid, oldComputer).expect(200);
    const end = await activatePlan(paid.storeId);
    const { agent } = await ownerOf(paid.storeId);

    const newComputer = computer();
    const fresh = await registerPos(app);
    await checkIn(fresh, newComputer).expect(200);
    const code = await linkCode(fresh, newComputer);

    const preview = await agent
      .post(`/api/owner/stores/${paid.storeId}/devices/link/preview`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(200);
    expect(preview.body).toMatchObject({
      target_store: { code: paid.storeId.replace(/-/g, '').slice(0, 8).toUpperCase() },
      computer: { id: fresh.posId },
      already_in_this_store: false,
      max_devices: 1,
      must_retire: true,
      // The café's current computer checked in moments ago, so it is not pre-selected.
      suggested_retire_id: null,
    });

    await agent
      .post(`/api/owner/stores/${paid.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code, retire_device_id: paid.posId })
      .expect(200);

    const claims = claimsOf((await checkIn(fresh, newComputer).expect(200)).body.token);
    expect(claims).toMatchObject({ store_id: paid.storeId, status: 'active' });
    expect(Date.parse(claims.ends_at)).toBe(end.getTime());
    await checkIn(paid, oldComputer).expect(410);
    const list = await agent.get(`/api/owner/stores/${paid.storeId}/devices`).expect(200);
    expect(list.body.devices.map((d: { id: string }) => d.id)).toEqual([fresh.posId]);

    // A used code can't be used again.
    await agent
      .post(`/api/owner/stores/${paid.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(400);
  });

  it('rebinds a POS restored from a backup on a new computer', async () => {
    const oldComputer = computer();
    const pos = await registerPos(app);
    await checkIn(pos, oldComputer).expect(200);
    const { agent } = await ownerOf(pos.storeId);

    const newComputer = computer();
    await checkIn(pos, newComputer).expect(409);
    const code = await linkCode(pos, newComputer);
    const preview = await agent
      .post(`/api/owner/stores/${pos.storeId}/devices/link/preview`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(200);
    expect(preview.body.already_in_this_store).toBe(true);
    await agent
      .post(`/api/owner/stores/${pos.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(200);
    await checkIn(pos, newComputer).expect(200);
    await checkIn(pos, oldComputer).expect(409);
  });

  it('lets only owners link, and refuses wrong codes and other people’s cafés', async () => {
    const target = await registerPos(app);
    const manager = await ownerOf(target.storeId, 'manager');
    const fresh = await registerPos(app);
    const machine = computer();
    const code = await linkCode(fresh, machine);
    await manager.agent
      .post(`/api/owner/stores/${target.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(403);

    const { agent } = await ownerOf(target.storeId);
    await agent
      .post(`/api/owner/stores/${target.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code: '00000000' })
      .expect(400);

    await ownerOf(fresh.storeId);
    const taken = await agent
      .post(`/api/owner/stores/${target.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(409);
    expect(taken.body.error).toBe('computer_belongs_to_another_store');
  });

  it('never moves a POS whose café has a paid plan', async () => {
    const target = await registerPos(app);
    const { agent } = await ownerOf(target.storeId);
    const other = await registerPos(app);
    await activatePlan(other.storeId);
    const code = await linkCode(other, computer());
    const res = await agent
      .post(`/api/owner/stores/${target.storeId}/devices/link`)
      .set(OWNER_CSRF)
      .send({ code })
      .expect(409);
    expect(res.body.error).toBe('computer_store_has_plan');
  });

  it('switches off a lost computer', async () => {
    const pos = await registerPos(app);
    const machine = computer();
    await checkIn(pos, machine).expect(200);
    const { agent } = await ownerOf(pos.storeId);
    await agent
      .post(`/api/owner/stores/${pos.storeId}/devices/${pos.posId}/retire`)
      .set(OWNER_CSRF)
      .expect(200);
    await checkIn(pos, machine).expect(410);
    const revoked = await db.query.posDevices.findFirst({
      where: and(eq(schema.posDevices.id, pos.posId)),
    });
    expect(revoked?.revokedAt).not.toBeNull();
  });
});

/** A customer trying not to pay. Each test is one attempt; every one must fail. */
describe('attempts to avoid paying', () => {
  const link = (agent: ReturnType<typeof request.agent>, storeId: string, body: object) =>
    agent.post(`/api/owner/stores/${storeId}/devices/link`).set(OWNER_CSRF).send(body);

  it('cannot run a second computer (another outlet) on one paid plan', async () => {
    const paid = await registerPos(app);
    await checkIn(paid, computer()).expect(200);
    await activatePlan(paid.storeId);
    const { agent } = await ownerOf(paid.storeId);

    const outlet = await registerPos(app);
    const outletComputer = computer();
    await checkIn(outlet, outletComputer).expect(200);
    const code = await linkCode(outlet, outletComputer);
    const kept = await link(agent, paid.storeId, { code, retire_device_id: null }).expect(409);
    expect(kept.body.error).toBe('device_limit');

    // Switching the old computer off is the only way in.
    await link(agent, paid.storeId, { code, retire_device_id: paid.posId }).expect(200);
    await checkIn(paid, computer()).expect(410);
  });

  it('cannot refresh an ended trial by linking the old computer into a new trial store', async () => {
    const oldComputer = computer();
    const original = await registerPos(app);
    await checkIn(original, oldComputer).expect(200);
    // The old computer's trial started 40 days ago and has ended.
    const started = new Date(Date.now() - 40 * DAY);
    await db
      .update(schema.machineTrials)
      .set({ firstSeenAt: started })
      .where(eq(schema.machineTrials.machineIdHash, oldComputer));
    await db
      .update(schema.subscriptions)
      .set({ trialEndsAt: new Date(started.getTime() + 30 * DAY) })
      .where(eq(schema.subscriptions.storeId, original.storeId));
    const { owner, agent } = await ownerOf(original.storeId);

    // A fresh virtual machine is a "new computer" with a fresh 30-day trial.
    const vm = await registerPos(app);
    const vmComputer = computer();
    await checkIn(vm, vmComputer).expect(200);
    await db
      .insert(schema.storeMembers)
      .values({ storeId: vm.storeId, ownerId: owner.id, role: 'owner' });

    // Move the real café computer, with all its data, onto the VM's fresh trial.
    const code = await linkCode(original, oldComputer);
    await link(agent, vm.storeId, { code, retire_device_id: vm.posId }).expect(200);
    const claims = claimsOf((await checkIn(original, oldComputer).expect(200)).body.token);
    expect(claims.status).toBe('inactive');
  });

  it('keeps a real new computer’s trial when it joins an older trial store', async () => {
    const first = computer();
    const cafe = await registerPos(app);
    await checkIn(cafe, first).expect(200);
    const before = (
      await db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.storeId, cafe.storeId))
    )[0];
    const { agent } = await ownerOf(cafe.storeId);
    const newComputer = computer();
    const fresh = await registerPos(app);
    await checkIn(fresh, newComputer).expect(200);
    const code = await linkCode(fresh, newComputer);
    await link(agent, cafe.storeId, { code, retire_device_id: cafe.posId }).expect(200);
    const after = (
      await db
        .select()
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.storeId, cafe.storeId),
            eq(schema.subscriptions.status, 'trial'),
          ),
        )
    )[0];
    expect(after.trialEndsAt?.getTime()).toBe(before.trialEndsAt?.getTime());
  });

  it('cannot guess link codes', async () => {
    const target = await registerPos(app);
    const { agent } = await ownerOf(target.storeId);
    for (let i = 0; i < 5; i++) {
      await link(agent, target.storeId, { code: String(10_000_000 + i) }).expect(400);
    }
    await link(agent, target.storeId, { code: '12345678' }).expect(429);
  });

  it('cannot take another café’s POS with a code it did not show', async () => {
    const victim = await registerPos(app);
    const victimComputer = computer();
    await checkIn(victim, victimComputer).expect(200);
    await ownerOf(victim.storeId);
    const code = await linkCode(victim, victimComputer);
    const attacker = await registerPos(app);
    const { agent } = await ownerOf(attacker.storeId);
    const res = await link(agent, attacker.storeId, { code }).expect(409);
    expect(res.body.error).toBe('computer_belongs_to_another_store');
  });

  it('gets no trial for a reinstall that re-registers from a wiped database', async () => {
    const machine = computer();
    await checkIn(await registerPos(app), machine).expect(200);
    for (let i = 0; i < 3; i++) {
      const again = await registerPos(app);
      await checkIn(again, machine).expect(202);
    }
  });

  it('gets no licence from a switched-off computer by asking again', async () => {
    const pos = await registerPos(app);
    const machine = computer();
    await checkIn(pos, machine).expect(200);
    const { agent } = await ownerOf(pos.storeId);
    await agent
      .post(`/api/owner/stores/${pos.storeId}/devices/${pos.posId}/retire`)
      .set(OWNER_CSRF)
      .expect(200);
    await checkIn(pos, machine).expect(410);
    await posCall(app, pos, 'POST', '/api/pos/link-code', { machine_id_hash: machine }).expect(410);
  });
});
