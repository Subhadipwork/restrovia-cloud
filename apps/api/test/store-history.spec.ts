/** Store detail history (online periods, backups, admin activity) and blocking a store's cloud access. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS, type SystemRoleKey } from '@restrovia/shared';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { currentStep, totpCode } from '../src/crypto/totp.js';
import type { Database } from '../src/db/database.module.js';
import * as schema from '../src/db/schema/index.js';
import { EmailService } from '../src/email/email.service.js';
import { recordPresence } from '../src/pos/device-status.js';
import {
  createTestApp,
  eventsBody,
  posCall,
  registerPos,
  resetDatabase,
  testDatabaseUrl,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let outbox: EmailService['outbox'];

const ADMIN_CSRF = { 'X-Restrovia-Admin': '1' };
const OWNER_CSRF = { 'X-Restrovia-Owner': '1' };
const PASSWORD = 'tea garden 42';
const MINUTE = 60_000;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  outbox = app.get(EmailService).outbox;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function adminAgent(role: SystemRoleKey) {
  const crypto = app.get(CryptoService);
  const email = `${role}-${randomUUID().slice(0, 8)}@restrovia.test`;
  await db.insert(schema.admins).values({
    name: `Test ${role}`,
    email,
    roleId: SYSTEM_ROLE_IDS[role],
    passwordHash: await crypto.hashPassword(PASSWORD),
  });
  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/api/admin/auth/login')
    .set(ADMIN_CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  await agent
    .post('/api/admin/auth/setup-2fa')
    .set(ADMIN_CSRF)
    .send({
      setup_token: login.body.setup_token,
      code: totpCode(login.body.secret as string, currentStep()),
    })
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
  return { agent, owner };
}

type Pos = Awaited<ReturnType<typeof registerPos>>;

const heartbeat = (pos: Pos) =>
  posCall(app, pos, 'POST', '/api/pos/heartbeat', {
    pos_hash: pos.posHash,
    app_version: '3.13.23',
    sent_at: new Date().toISOString(),
  });

const backupEvent = (type: string, payload: unknown) => ({
  id: randomUUID(),
  type,
  entity_type: 'backup',
  entity_id: randomUUID(),
  payload,
});

describe('online history', () => {
  it('extends an online period while the POS keeps checking in and starts a new one after a gap', async () => {
    const pos = await registerPos(app);
    const device = { id: pos.posId, storeId: pos.storeId };
    const t0 = new Date(Date.now() - 60 * MINUTE);
    const presenceDb = db as unknown as Database;
    await recordPresence(presenceDb, device, t0);
    await recordPresence(presenceDb, device, new Date(t0.getTime() + 5 * MINUTE));
    await recordPresence(presenceDb, device, new Date(t0.getTime() + 10 * MINUTE));
    await recordPresence(presenceDb, device, new Date(t0.getTime() + 40 * MINUTE));

    const rows = await db
      .select()
      .from(schema.posPresence)
      .where(eq(schema.posPresence.deviceId, pos.posId))
      .orderBy(schema.posPresence.startedAt);
    expect(rows.map((r) => [r.startedAt.getTime(), r.lastSeenAt.getTime()])).toEqual([
      [t0.getTime(), t0.getTime() + 10 * MINUTE],
      [t0.getTime() + 40 * MINUTE, t0.getTime() + 40 * MINUTE],
    ]);
  });

  it('records heartbeats as online periods and shows them with uptime to admins', async () => {
    const pos = await registerPos(app);
    await heartbeat(pos).expect(200);
    await heartbeat(pos).expect(200);

    const agent = await adminAgent('support');
    const res = await agent.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    const history = res.body.online_history;
    expect(history.window_days).toBe(30);
    expect(history.periods).toHaveLength(1);
    expect(history.periods[0].device_id).toBe(pos.posId);
    expect(history.devices[0]).toMatchObject({ device_id: pos.posId });
    expect(history.devices[0].recorded_since).toMatch(/Z$/);
  });
});

describe('backup history', () => {
  it('stores backup reports sent as POS events, once each, and skips unreadable ones', async () => {
    const pos = await registerPos(app);
    const done = backupEvent('backup.completed', {
      destination: 'google_drive',
      file_name: 'restrovia-2026-11-12.db',
      size_bytes: 1_048_576,
      occurred_at: '2026-11-12T02:00:00.000Z',
    });
    const failed = backupEvent('backup.failed', {
      destination: 'local',
      error: 'Disk full',
      occurred_at: '2026-11-12T03:00:00+05:30',
    });
    const broken = backupEvent('backup.completed', { destination: 'local' });

    const first = await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [done, failed, broken]),
    ).expect(200);
    expect(first.body).toMatchObject({ accepted: 3, rejected: 1 });
    await posCall(app, pos, 'POST', '/api/pos/events', eventsBody(pos, [done])).expect(200);

    const agent = await adminAgent('support');
    const res = await agent.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    expect(res.body.backups.recent).toHaveLength(2);
    expect(res.body.backups.recent[0]).toMatchObject({
      status: 'success',
      destination: 'google_drive',
      size_bytes: 1_048_576,
      occurred_at: '2026-11-12T02:00:00.000Z',
    });
    expect(res.body.backups.recent[1]).toMatchObject({
      status: 'failed',
      destination: 'local',
      error: 'Disk full',
      occurred_at: '2026-11-11T21:30:00.000Z',
    });
    expect(res.body.backups.last_success_at).toBe('2026-11-12T02:00:00.000Z');
  });
});

describe('blocking a store', () => {
  it('only lets super admins and sales block a store, with a reason', async () => {
    const pos = await registerPos(app);
    const support = await adminAgent('support');
    await support
      .post(`/api/admin/stores/${pos.storeId}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'block', reason: 'Unpaid invoice' })
      .expect(403);
    const sales = await adminAgent('sales');
    await sales
      .post(`/api/admin/stores/${pos.storeId}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'block', reason: ' ' })
      .expect(400);
    await sales
      .post(`/api/admin/stores/${randomUUID()}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'block', reason: 'Unpaid invoice' })
      .expect(404);
  });

  it('stops store data reaching the cloud and the owner portal, tells the owners, and lifts cleanly', async () => {
    const pos = await registerPos(app);
    const { agent: ownerAgent, owner } = await ownerOf(pos.storeId);
    const { owner: manager } = await ownerOf(pos.storeId, 'manager');
    const admin = await adminAgent('super_admin');
    const reason = 'Unpaid invoice INV-42';

    const blocked = await admin
      .post(`/api/admin/stores/${pos.storeId}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'block', reason })
      .expect(200);
    expect(blocked.body).toEqual({ status: 'blocked', reason, notified: 2 });
    for (const to of [owner.email, manager.email]) {
      const mail = outbox.filter((m) => m.to === to).at(-1);
      expect(mail?.subject).toBe('Blue Door Café: Restrovia Cloud access is blocked');
      expect(mail?.text).toContain(reason);
    }
    await admin
      .post(`/api/admin/stores/${pos.storeId}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'block', reason })
      .expect(409);

    // The POS keeps its heartbeat (and sync on), learns why, and stops sending orders and reports.
    const beat = await heartbeat(pos).expect(200);
    expect(beat.body.store_notice).toMatchObject({ status: 'blocked', reason });
    expect(beat.body.store_notice.since).toMatch(/Z$/);
    expect(beat.body.features).toEqual({
      cloud_sync_enabled: true,
      cloud_orders_enabled: false,
      cloud_reports_enabled: false,
    });
    const refused = await posCall(app, pos, 'POST', '/api/pos/events', eventsBody(pos, [])).expect(
      403,
    );
    expect(refused.body).toMatchObject({ error: 'store_blocked', reason });
    await posCall(app, pos, 'GET', '/api/pos/commands').expect(403);
    await posCall(app, pos, 'POST', '/api/pos/pairing-code', {}).expect(403);

    // Owners still see the store in their list, marked blocked, but can't open it.
    const list = await ownerAgent.get('/api/owner/stores').expect(200);
    expect(list.body.stores[0].blocked).toMatchObject({ reason });
    const closed = await ownerAgent.get(`/api/owner/stores/${pos.storeId}`).expect(403);
    expect(closed.body).toMatchObject({ error: 'store_blocked', reason });

    const detail = await admin.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    expect(detail.body.store.status).toBe('suspended');
    expect(detail.body.block).toMatchObject({ reason, lifted_at: null });
    expect(detail.body.activity[0]).toMatchObject({
      action: 'store.block',
      admin_name: 'Test super_admin',
      details: { reason, notify_owners: true },
    });

    const lifted = await admin
      .post(`/api/admin/stores/${pos.storeId}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'unblock' })
      .expect(200);
    expect(lifted.body).toEqual({ status: 'active', reason: null, notified: 2 });
    expect(outbox.filter((m) => m.to === owner.email).at(-1)?.subject).toBe(
      'Blue Door Café: Restrovia Cloud access is restored',
    );
    const history = await admin.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    expect(history.body.block).toBeNull();
    expect(history.body.block_history).toHaveLength(1);
    expect(history.body.block_history[0].lifted_at).toMatch(/Z$/);
    const after = await heartbeat(pos).expect(200);
    expect(after.body.store_notice).toBeNull();
    expect(after.body.features.cloud_orders_enabled).toBe(true);
    await posCall(app, pos, 'POST', '/api/pos/events', eventsBody(pos, [])).expect(200);
    await ownerAgent.get(`/api/owner/stores/${pos.storeId}`).expect(200);
  });

  it('blocks without emailing when the admin turns notifications off', async () => {
    const pos = await registerPos(app);
    const { owner } = await ownerOf(pos.storeId);
    const admin = await adminAgent('sales');
    const res = await admin
      .post(`/api/admin/stores/${pos.storeId}/status`)
      .set(ADMIN_CSRF)
      .send({ action: 'block', reason: 'Fraud check', notify_owners: false })
      .expect(200);
    expect(res.body.notified).toBe(0);
    expect(outbox.some((m) => m.to === owner.email)).toBe(false);
  });
});
