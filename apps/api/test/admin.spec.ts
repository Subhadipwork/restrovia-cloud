/** Admin panel API: sign-in with 2FA, roles, licences, tickets, admins and the audit log. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import type { AdminRole } from '@restrovia/shared';
import { base32Encode, currentStep, totpCode, verifyTotp } from '../src/crypto/totp.js';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { LicenceService } from '../src/pos/licence.service.js';
import { createTestApp, posCall, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const CSRF = { 'X-Restrovia-Admin': '1' };

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  app = await createTestApp(url);
  await db.insert(schema.plans).values([
    { code: 'outlet_monthly', name: 'Outlet monthly', price: '999.00', interval: 'month' },
    { code: 'outlet_yearly', name: 'Outlet yearly', price: '9999.00', interval: 'year' },
  ]);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function createAdmin(role: AdminRole, password = 'correct horse battery') {
  const email = `${role}-${randomUUID().slice(0, 8)}@restrovia.test`;
  const crypto = app.get(CryptoService);
  const [row] = await db
    .insert(schema.admins)
    .values({
      name: `Test ${role}`,
      email,
      role,
      passwordHash: await crypto.hashPassword(password),
    })
    .returning();
  return { ...row, password };
}

/** Signs in through first-time 2FA setup; returns a cookie-keeping agent and the TOTP secret. */
async function signIn(role: AdminRole) {
  const admin = await createAdmin(role);
  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/api/admin/auth/login')
    .set(CSRF)
    .send({ email: admin.email, password: admin.password })
    .expect(200);
  expect(login.body.status).toBe('setup_required');
  const secret = login.body.secret as string;
  await agent
    .post('/api/admin/auth/setup-2fa')
    .set(CSRF)
    .send({ setup_token: login.body.setup_token, code: totpCode(secret, currentStep()) })
    .expect(200);
  return { agent, admin, secret };
}

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpCode(secret, 1)).toBe('287082'); // T = 59 s; the RFC's 8-digit value is 94287082
    expect(verifyTotp(secret, '287082', 59_000)).toBe(1);
    expect(verifyTotp(secret, '000000', 59_000)).toBeNull();
  });
});

describe('admin sign-in', () => {
  it('sends a new admin through 2FA setup, then signs them in with a cookie', async () => {
    const { agent, admin } = await signIn('super_admin');
    const me = await agent.get('/api/admin/auth/me').expect(200);
    expect(me.body.admin).toMatchObject({ email: admin.email, role: 'super_admin' });
    const stored = await db.query.admins.findFirst({ where: eq(schema.admins.id, admin.id) });
    expect(stored?.totpSecretEnc).toBeInstanceOf(Buffer);
  });

  it('sets an HttpOnly, SameSite=Strict cookie scoped to the admin API', async () => {
    const admin = await createAdmin('support');
    const login = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: admin.email, password: admin.password });
    const agent = request(app.getHttpServer());
    const secret = login.body.secret;
    const res = await agent
      .post('/api/admin/auth/setup-2fa')
      .set(CSRF)
      .send({ setup_token: login.body.setup_token, code: totpCode(secret, currentStep()) })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rv_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/admin/);
  });

  it('needs the code once 2FA is set, and refuses a code that was already used', async () => {
    const { admin, secret } = await signIn('support');
    const server = request(app.getHttpServer());
    await server
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: admin.email, password: admin.password })
      .expect(401, /code_required/);
    // The setup used the current step, so the same code is refused...
    await server
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: admin.email, password: admin.password, code: totpCode(secret, currentStep()) })
      .expect(401, /invalid_code/);
    // ...and the next one is accepted.
    await server
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({
        email: admin.email,
        password: admin.password,
        code: totpCode(secret, currentStep() + 1),
      })
      .expect(200);
  });

  it('refuses a wrong password, an unknown email and a disabled admin the same way', async () => {
    const admin = await createAdmin('sales');
    const server = request(app.getHttpServer());
    for (const body of [
      { email: admin.email, password: 'wrong password' },
      { email: 'nobody@restrovia.test', password: 'whatever' },
    ]) {
      const res = await server.post('/api/admin/auth/login').set(CSRF).send(body).expect(401);
      expect(res.body.error).toBe('invalid_credentials');
    }
    await db
      .update(schema.admins)
      .set({ status: 'disabled' })
      .where(eq(schema.admins.id, admin.id));
    const res = await server
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: admin.email, password: admin.password })
      .expect(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('refuses requests without a session, and changes without the panel header', async () => {
    await request(app.getHttpServer()).get('/api/admin/overview').expect(401);
    const { agent } = await signIn('super_admin');
    await agent.post('/api/admin/auth/logout').expect(403);
    await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: 'x@y.z', password: 'x' })
      .expect(403);
  });

  it('logs out by ending the session', async () => {
    const { agent } = await signIn('sales');
    await agent.post('/api/admin/auth/logout').set(CSRF).expect(200);
    await agent.get('/api/admin/auth/me').expect(401);
  });
});

describe('roles', () => {
  it('limits licences to super admins and sales, and tickets to super admins and support', async () => {
    const pos = await registerPos(app);
    const support = await signIn('support');
    const sales = await signIn('sales');
    await support.agent
      .post(`/api/admin/stores/${pos.storeId}/licence`)
      .set(CSRF)
      .send({ action: 'suspend' })
      .expect(403);
    await sales.agent.get('/api/admin/tickets').expect(403);
    await sales.agent.get('/api/admin/admins').expect(403);
    await support.agent.get('/api/admin/audit-log').expect(403);
    await support.agent.get('/api/admin/stores').expect(200);
  });
});

describe('stores and licences', () => {
  let agent: request.Agent;
  let storeId: string;
  let pos: Awaited<ReturnType<typeof registerPos>>;

  beforeAll(async () => {
    ({ agent } = await signIn('super_admin'));
    pos = await registerPos(app);
    storeId = pos.storeId;
    await posCall(app, pos, 'POST', '/api/pos/heartbeat', {
      pos_hash: pos.posHash,
      app_version: '3.13.14',
      sent_at: new Date().toISOString(),
    }).expect(200);
  });

  it('shows the overview', async () => {
    const res = await agent.get('/api/admin/overview').expect(200);
    expect(res.body.online_now).toBeGreaterThanOrEqual(1);
    expect(res.body.licences.trial).toBeGreaterThanOrEqual(1);
    expect(res.body.versions.some((v: { version: string }) => v.version === '3.13.14')).toBe(true);
  });

  it('lists and searches stores with online and licence status', async () => {
    const res = await agent
      .get('/api/admin/stores')
      .query({ search: 'blue door', per_page: 100 })
      .expect(200);
    const row = res.body.data.find((s: { id: string }) => s.id === storeId);
    expect(row).toMatchObject({
      name: 'Blue Door Café',
      online: true,
      licence_status: 'trial',
      app_version: '3.13.14',
    });
    const none = await agent.get('/api/admin/stores').query({ search: 'no such café' }).expect(200);
    expect(none.body.total).toBe(0);
  });

  it('finds a store by the store code the POS shows, or by its full id', async () => {
    const code = storeId.replace(/-/g, '').slice(0, 8).toUpperCase();
    for (const search of [code, storeId]) {
      const res = await agent.get('/api/admin/stores').query({ search }).expect(200);
      expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([storeId]);
    }
  });

  it('shows a store with its devices and licence history', async () => {
    const res = await agent.get(`/api/admin/stores/${storeId}`).expect(200);
    expect(res.body.store.name).toBe('Blue Door Café');
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].online).toBe(true);
    expect(res.body.licence_history[0].status).toBe('trial');
    await agent.get(`/api/admin/stores/${randomUUID()}`).expect(404);
  });

  it('extends a trial', async () => {
    const before = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.storeId, storeId),
    });
    const res = await agent
      .post(`/api/admin/stores/${storeId}/licence`)
      .set(CSRF)
      .send({ action: 'extend_trial', days: 15 })
      .expect(200);
    const added =
      (Date.parse(res.body.trial_ends_at) - before!.trialEndsAt!.getTime()) / 86_400_000;
    expect(Math.round(added)).toBe(15);
  });

  it('activates a plan with a manual payment, replacing the trial', async () => {
    const res = await agent
      .post(`/api/admin/stores/${storeId}/licence`)
      .set(CSRF)
      .send({
        action: 'activate',
        plan_code: 'outlet_yearly',
        amount: '9999.00',
        note: 'Paid by UPI',
      })
      .expect(200);
    expect(res.body.status).toBe('active');
    const detail = await agent.get(`/api/admin/stores/${storeId}`).expect(200);
    expect(detail.body.licence_history.map((s: { status: string }) => s.status)).toEqual([
      'active',
      'cancelled',
    ]);
    expect(detail.body.payments[0]).toMatchObject({ amount: '9999.00', method: 'manual' });
    await agent
      .post(`/api/admin/stores/${storeId}/licence`)
      .set(CSRF)
      .send({ action: 'extend_trial', days: 5 })
      .expect(409);
    await agent
      .post(`/api/admin/stores/${storeId}/licence`)
      .set(CSRF)
      .send({ action: 'activate', plan_code: 'nope' })
      .expect(400);
  });

  it('suspends a licence, which turns off cloud orders and reports for the POS', async () => {
    await agent
      .post(`/api/admin/stores/${storeId}/licence`)
      .set(CSRF)
      .send({ action: 'suspend', note: 'Unpaid' })
      .expect(200);
    const features = await app.get(LicenceService).featuresFor(storeId);
    expect(features).toEqual({
      cloud_sync_enabled: true,
      cloud_orders_enabled: false,
      cloud_reports_enabled: false,
    });
  });

  it('records every licence change in the audit log', async () => {
    const res = await agent.get('/api/admin/audit-log').query({ target_id: storeId }).expect(200);
    expect(res.body.data.map((r: { action: string }) => r.action)).toEqual([
      'licence.suspend',
      'licence.activate',
      'licence.extend_trial',
    ]);
    expect(res.body.data[1].details).toMatchObject({
      plan_code: 'outlet_yearly',
      amount: '9999.00',
    });
  });
});

describe('support tickets', () => {
  it('lists tickets, changes status and adds notes', async () => {
    const { agent } = await signIn('support');
    const pos = await registerPos(app);
    const sent = await posCall(app, pos, 'POST', '/api/pos/support-ticket', {
      client_ticket_id: randomUUID(),
      subject: 'KOT printer offline',
      message: 'Since morning',
      event_code: 'support.printer',
    }).expect(200);

    const list = await agent.get('/api/admin/tickets').query({ status: 'open' }).expect(200);
    const ticket = list.body.data.find(
      (t: { support_code: string }) => t.support_code === sent.body.support_code,
    );
    expect(ticket).toMatchObject({
      subject: 'KOT printer offline',
      store_name: 'Blue Door Café',
      status: 'open',
    });

    await agent
      .patch(`/api/admin/tickets/${ticket.id}`)
      .set(CSRF)
      .send({ status: 'resolved' })
      .expect(200);
    await agent
      .post(`/api/admin/tickets/${ticket.id}/notes`)
      .set(CSRF)
      .send({ body: 'Printer IP changed; fixed by phone.' })
      .expect(201);
    const detail = await agent.get(`/api/admin/tickets/${ticket.id}`).expect(200);
    expect(detail.body.ticket.status).toBe('resolved');
    expect(detail.body.ticket.resolvedAt).toBeTruthy();
    expect(detail.body.notes[0].body).toBe('Printer IP changed; fixed by phone.');
  });
});

describe('admin users', () => {
  it('creates, disables and resets admins; a disabled admin is signed out', async () => {
    const boss = await signIn('super_admin');
    const created = await boss.agent
      .post('/api/admin/admins')
      .set(CSRF)
      .send({
        name: 'Ravi',
        email: 'ravi@restrovia.test',
        role: 'support',
        password: 'a long enough password',
      })
      .expect(201);
    await boss.agent
      .post('/api/admin/admins')
      .set(CSRF)
      .send({
        name: 'Ravi again',
        email: 'RAVI@restrovia.test',
        role: 'support',
        password: 'a long enough password',
      })
      .expect(409);
    await boss.agent
      .post('/api/admin/admins')
      .set(CSRF)
      .send({ name: 'Short', email: 'short@restrovia.test', role: 'support', password: 'short' })
      .expect(400);

    const other = await signIn('sales');
    await boss.agent.post(`/api/admin/admins/${other.admin.id}/disable`).set(CSRF).expect(200);
    await other.agent.get('/api/admin/auth/me').expect(401);
    await boss.agent.post(`/api/admin/admins/${boss.admin.id}/disable`).set(CSRF).expect(400);

    await boss.agent.post(`/api/admin/admins/${created.body.id}/reset-2fa`).set(CSRF).expect(200);
    const list = await boss.agent.get('/api/admin/admins').expect(200);
    expect(
      list.body.find((a: { email: string }) => a.email === 'ravi@restrovia.test'),
    ).toMatchObject({ two_factor: false, status: 'active' });
  });
});

describe('plans', () => {
  it('lists plans with how many stores are on each', async () => {
    const { agent } = await signIn('sales');
    const res = await agent.get('/api/admin/plans').query({ include_inactive: 'true' }).expect(200);
    const yearly = res.body.find((p: { code: string }) => p.code === 'outlet_yearly');
    expect(yearly).toMatchObject({
      name: 'Outlet yearly',
      price: '9999.00',
      interval: 'year',
      is_active: true,
      max_devices: 1,
    });
    expect(typeof yearly.active_stores).toBe('number');
  });

  it('lets a super admin create, reprice and turn off a plan, and records each change', async () => {
    const { agent } = await signIn('super_admin');
    const created = await agent
      .post('/api/admin/plans')
      .set(CSRF)
      .send({
        code: 'multi_outlet_yearly',
        name: 'Multi-outlet yearly',
        price: '24999',
        interval: 'year',
        max_devices: 3,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      code: 'multi_outlet_yearly',
      price: '24999.00',
      currency: 'INR',
      maxDevices: 3,
    });

    await agent
      .post('/api/admin/plans')
      .set(CSRF)
      .send({ code: 'multi_outlet_yearly', name: 'Copy', price: '1', interval: 'year' })
      .expect(409);
    await agent
      .post('/api/admin/plans')
      .set(CSRF)
      .send({ code: 'Bad Code', name: 'x', price: '1', interval: 'year' })
      .expect(400);

    await agent
      .patch(`/api/admin/plans/${created.body.id}`)
      .set(CSRF)
      .send({ price: '22999.50' })
      .expect(200);
    await agent
      .patch(`/api/admin/plans/${created.body.id}`)
      .set(CSRF)
      .send({ is_active: false })
      .expect(200);
    await agent.patch(`/api/admin/plans/${created.body.id}`).set(CSRF).send({}).expect(400);

    const onSale = await agent.get('/api/admin/plans').expect(200);
    expect(onSale.body.some((p: { code: string }) => p.code === 'multi_outlet_yearly')).toBe(false);
    const all = await agent.get('/api/admin/plans').query({ include_inactive: 'true' }).expect(200);
    expect(all.body.find((p: { code: string }) => p.code === 'multi_outlet_yearly')).toMatchObject({
      price: '22999.50',
      is_active: false,
    });

    const audit = await agent
      .get('/api/admin/audit-log')
      .query({ target_id: created.body.id })
      .expect(200);
    expect(audit.body.data.map((r: { action: string }) => r.action)).toEqual([
      'plan.update',
      'plan.update',
      'plan.create',
    ]);
    expect(audit.body.data[1].details).toMatchObject({
      changes: { price: '22999.50' },
      before: { price: '24999.00' },
    });
  });

  it('lets only super admins change plans', async () => {
    const { agent } = await signIn('sales');
    await agent
      .post('/api/admin/plans')
      .set(CSRF)
      .send({ code: 'nope', name: 'x', price: '1', interval: 'month' })
      .expect(403);
  });
});

describe('device binding', () => {
  it('counts a licence check-in as the device being seen when heartbeats have stopped', async () => {
    const { agent } = await signIn('support');
    const pos = await registerPos(app);
    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    await db
      .update(schema.posDevices)
      .set({ lastHeartbeatAt: yesterday, lastLicenceAt: new Date() })
      .where(eq(schema.posDevices.id, pos.posId));

    const detail = await agent.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    expect(detail.body.devices[0].online).toBe(true);
    expect(new Date(detail.body.devices[0].last_seen_at).getTime()).toBeGreaterThan(yesterday.getTime());

    const list = await agent.get('/api/admin/stores').query({ q: pos.storeId }).expect(200);
    expect(list.body.data[0].online).toBe(true);
  });

  it('lets support reset a device so it can check in from a new computer', async () => {
    const { agent } = await signIn('support');
    const pos = await registerPos(app);
    await db
      .update(schema.posDevices)
      .set({ machineIdHash: 'a'.repeat(64) })
      .where(eq(schema.posDevices.id, pos.posId));
    const before = await agent.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    expect(before.body.devices[0].machine_bound).toBe(true);

    await agent
      .post(`/api/admin/stores/${pos.storeId}/devices/${pos.posId}/reset-binding`)
      .set(CSRF)
      .expect(200);
    const after = await agent.get(`/api/admin/stores/${pos.storeId}`).expect(200);
    expect(after.body.devices[0].machine_bound).toBe(false);
    const audit = await db.query.adminAuditLog.findFirst({
      where: eq(schema.adminAuditLog.targetId, pos.posId),
    });
    expect(audit?.action).toBe('device.reset_binding');

    const sales = await signIn('sales');
    await sales.agent
      .post(`/api/admin/stores/${pos.storeId}/devices/${pos.posId}/reset-binding`)
      .set(CSRF)
      .expect(403);
  });
});
