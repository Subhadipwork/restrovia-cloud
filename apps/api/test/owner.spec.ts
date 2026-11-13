/** Owner accounts: invites from the Restrovia team, sign-in, sessions, 2FA, passwords and support tools. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS, type SystemRoleKey } from '@restrovia/shared';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { currentStep, totpCode } from '../src/crypto/totp.js';
import * as schema from '../src/db/schema/index.js';
import { EmailService } from '../src/email/email.service.js';
import { createTestApp, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let outbox: EmailService['outbox'];

const CSRF = { 'X-Restrovia-Owner': '1' };
const ADMIN_CSRF = { 'X-Restrovia-Admin': '1' };
const PASSWORD = 'tea garden 42';

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  outbox = app.get(EmailService).outbox;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

afterEach(() => {
  vi.useRealTimers();
});

const server = () => request(app.getHttpServer());
const newEmail = () => `owner-${randomUUID().slice(0, 8)}@restrovia.test`;

function lastEmailTo(to: string) {
  const found = outbox.filter((m) => m.to === to).at(-1);
  if (!found) throw new Error(`No email to ${to}`);
  return found;
}

function linkToken(to: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(lastEmailTo(to).text);
  if (!match) throw new Error(`No link in the last email to ${to}`);
  return match[1];
}

const ownerByEmail = (email: string) =>
  db.query.owners.findFirst({ where: eq(schema.owners.email, email) });

/** An admin creates the owner account for a store; returns the store id. */
async function invite(email: string, role: SystemRoleKey = 'support', storeId?: string) {
  const store = storeId ?? (await registerPos(app)).storeId;
  const { token } = await adminSession(role);
  await server()
    .post(`/api/admin/stores/${store}/owners`)
    .set(ADMIN_CSRF)
    .set('Cookie', `rv_admin=${token}`)
    .send({ name: 'Asha', email })
    .expect(201);
  return store;
}

/** A set-up owner: invited by support, password chosen from the invite link; returns the email. */
async function createOwner(email = newEmail(), password = PASSWORD) {
  await invite(email);
  await server()
    .post('/api/owner/auth/set-password')
    .set(CSRF)
    .send({ token: linkToken(email), password })
    .expect(200);
  return email;
}

async function signIn(email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/api/owner/auth/login')
    .set(CSRF)
    .send({ email, password })
    .expect(200);
  return { agent, res };
}

/** A verified owner with 2FA on; the authenticator step used to turn it on is `step`. */
async function ownerWithTwoFactor() {
  const email = await createOwner();
  const { agent } = await signIn(email);
  const setup = await agent
    .post('/api/owner/me/2fa/setup')
    .set(CSRF)
    .send({ password: PASSWORD })
    .expect(200);
  const step = currentStep();
  const enabled = await agent
    .post('/api/owner/me/2fa/enable')
    .set(CSRF)
    .send({ setup_token: setup.body.setup_token, code: totpCode(setup.body.secret, step) })
    .expect(200);
  return {
    email,
    agent,
    secret: setup.body.secret as string,
    step,
    recoveryCodes: enabled.body.recovery_codes as string[],
  };
}

async function challenge(email: string) {
  const res = await server()
    .post('/api/owner/auth/login')
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  expect(res.body.status).toBe('2fa_required');
  return res.body.challenge_token as string;
}

describe('accounts created by Restrovia', () => {
  it('invites the owner, who chooses a password and is signed in with the store linked', async () => {
    const email = newEmail();
    const storeId = await invite(email);
    const invited = (await ownerByEmail(email))!;
    expect(invited.passwordHash).toBeNull();
    expect(lastEmailTo(email).subject).toBe('Your Restrovia account is ready');

    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/api/owner/auth/set-password')
      .set(CSRF)
      .send({ token: linkToken(email), password: PASSWORD })
      .expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/rv_owner=/);
    const me = await agent.get('/api/owner/me').expect(200);
    expect(me.body.owner).toMatchObject({ email, email_verified: true, two_factor_enabled: false });
    const members = await db
      .select()
      .from(schema.storeMembers)
      .where(eq(schema.storeMembers.ownerId, invited.id));
    expect(members).toMatchObject([{ storeId, role: 'owner' }]);

    await agent.post('/api/owner/auth/logout').set(CSRF).expect(200);
    await agent.get('/api/owner/me').expect(401);
    await signIn(email);
  });

  it('has no public sign-up', async () => {
    await server()
      .post('/api/owner/auth/sign-up')
      .set(CSRF)
      .send({ name: 'Asha', email: newEmail(), password: PASSWORD })
      .expect(404);
  });

  it('refuses sign-in before the invite is accepted, like a wrong password', async () => {
    const email = newEmail();
    await invite(email);
    const res = await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(401);
    expect(res.body).toEqual({ error: 'invalid_credentials' });
  });

  it('keeps the invite link for a refused password, then lets it work only once', async () => {
    const email = newEmail();
    await invite(email);
    const token = linkToken(email);
    for (const [password, reason] of [
      ['short1', 'length'],
      ['password123', 'common'],
      [email, 'email'],
    ]) {
      const res = await server()
        .post('/api/owner/auth/set-password')
        .set(CSRF)
        .send({ token, password });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(reason);
    }
    await server()
      .post('/api/owner/auth/set-password')
      .set(CSRF)
      .send({ token, password: PASSWORD })
      .expect(200);
    await server()
      .post('/api/owner/auth/set-password')
      .set(CSRF)
      .send({ token, password: 'another tea garden' })
      .expect(400, /invalid_token/);
  });

  it('expires the invite link after 7 days', async () => {
    const email = newEmail();
    await invite(email);
    const token = linkToken(email);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 8 * 24 * 3_600_000);
    await server()
      .post('/api/owner/auth/set-password')
      .set(CSRF)
      .send({ token, password: PASSWORD })
      .expect(400, /invalid_token/);
  });

  it('links an existing owner to a second store instead of making another account', async () => {
    const email = await createOwner();
    const second = await registerPos(app);
    await invite(email, 'sales', second.storeId);
    const rows = await db.select().from(schema.owners).where(eq(schema.owners.email, email));
    expect(rows).toHaveLength(1);
    const members = await db
      .select()
      .from(schema.storeMembers)
      .where(eq(schema.storeMembers.ownerId, rows[0].id));
    expect(members).toHaveLength(2);
    expect(lastEmailTo(email).subject).toMatch(/was added to your Restrovia account/);

    const { token } = await adminSession('support');
    await server()
      .post(`/api/admin/stores/${second.storeId}/owners`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${token}`)
      .send({ name: 'Asha', email })
      .expect(409, /already_linked/);
  });

  it('resends an invite: the old link stops working, and it is refused once set up', async () => {
    const email = newEmail();
    await invite(email);
    const first = linkToken(email);
    const owner = (await ownerByEmail(email))!;
    const { token } = await adminSession('sales');
    await server()
      .post(`/api/admin/owners/${owner.id}/resend-invite`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${token}`)
      .expect(200);
    const second = linkToken(email);
    expect(second).not.toBe(first);
    await server()
      .post('/api/owner/auth/set-password')
      .set(CSRF)
      .send({ token: first, password: PASSWORD })
      .expect(400, /invalid_token/);
    await server()
      .post('/api/owner/auth/set-password')
      .set(CSRF)
      .send({ token: second, password: PASSWORD })
      .expect(200);
    await server()
      .post(`/api/admin/owners/${owner.id}/resend-invite`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${token}`)
      .expect(409, /already_set_up/);
  });

  it('lets an invited owner use "forgot password" when the invite is lost', async () => {
    const email = newEmail();
    await invite(email);
    await server().post('/api/owner/auth/password/forgot').set(CSRF).send({ email }).expect(200);
    await server()
      .post('/api/owner/auth/password/reset')
      .set(CSRF)
      .send({ token: linkToken(email), password: PASSWORD })
      .expect(200);
    await signIn(email);
  });

  it('audits creating and unlinking, and keeps unlinking to support', async () => {
    const email = newEmail();
    const storeId = await invite(email);
    const owner = (await ownerByEmail(email))!;
    const created = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'owner.create'),
          eq(schema.adminAuditLog.targetId, owner.id),
        ),
      );
    expect(created[0].details).toEqual({ store_id: storeId, password_set: false });
    expect(owner.createdByAdminId).toBe(created[0].adminId);

    const sales = await adminSession('sales');
    await server()
      .delete(`/api/admin/stores/${storeId}/owners/${owner.id}`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${sales.token}`)
      .expect(403);
    const support = await adminSession('support');
    await server()
      .delete(`/api/admin/stores/${storeId}/owners/${owner.id}`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${support.token}`)
      .expect(200);
    const members = await db
      .select()
      .from(schema.storeMembers)
      .where(eq(schema.storeMembers.ownerId, owner.id));
    expect(members).toHaveLength(0);
  });

  it('sets an HttpOnly, SameSite=Lax cookie scoped to the owner API', async () => {
    const email = await createOwner();
    const { res } = await signIn(email);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rv_owner=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/owner/);
  });
});

describe('sign-in', () => {
  it('refuses an unknown email and a wrong password with the same error', async () => {
    const email = await createOwner();
    const wrong = await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: 'not the password' });
    const unknown = await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email: newEmail(), password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('refuses changes without the portal header', async () => {
    const email = await createOwner();
    await server()
      .post('/api/owner/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403, /missing_csrf_header/);
    const { agent } = await signIn(email);
    await agent
      .patch('/api/owner/me')
      .send({ name: 'Changed' })
      .expect(403, /missing_csrf_header/);
    await agent.patch('/api/owner/me').set(CSRF).send({ name: 'Changed' }).expect(200);
  });

  it('keeps owner and admin cookies apart', async () => {
    const email = await createOwner();
    const { res } = await signIn(email);
    const ownerToken = /rv_owner=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
    await server().get('/api/admin/auth/me').set('Cookie', `rv_admin=${ownerToken}`).expect(401);

    const { token } = await adminSession('super_admin');
    await server().get('/api/owner/me').set('Cookie', `rv_owner=${token}`).expect(401);
  });

  it('locks the account after 10 wrong passwords and opens it again after 15 minutes', async () => {
    const email = await createOwner();
    for (let i = 0; i < 10; i++) {
      await server()
        .post('/api/owner/auth/login')
        .set(CSRF)
        .send({ email, password: 'wrong password' })
        .expect(401);
    }
    expect(lastEmailTo(email).subject).toMatch(/locked/);
    // The right password is refused like a wrong one while locked.
    await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(401, /invalid_credentials/);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await signIn(email);
    expect((await ownerByEmail(email))?.failedLogins).toBe(0);
  });

  it('lists sessions and signs out another one', async () => {
    const email = await createOwner();
    const first = await signIn(email);
    const second = await signIn(email);
    // Accepting the invite signed in too, so there are three.
    const list = await first.agent.get('/api/owner/me/sessions').expect(200);
    expect(list.body.sessions).toHaveLength(3);
    const own = await second.agent.get('/api/owner/me/sessions').expect(200);
    const other = own.body.sessions.find((s: { current: boolean }) => s.current);
    await first.agent.delete(`/api/owner/me/sessions/${other.id}`).set(CSRF).expect(200);
    await second.agent.get('/api/owner/me').expect(401);
    await first.agent.get('/api/owner/me').expect(200);
  });
});

describe('two-factor authentication', () => {
  it('asks for a code after the password and refuses a code that was already used', async () => {
    const { email, secret, step } = await ownerWithTwoFactor();
    const token = await challenge(email);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: token, code: totpCode(secret, step) })
      .expect(401, /invalid_code/);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: token, code: totpCode(secret, step + 3) })
      .expect(401, /invalid_code/);
    const ok = await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: token, code: totpCode(secret, step + 1) })
      .expect(200);
    expect(String(ok.headers['set-cookie'])).toMatch(/rv_owner=/);
    expect(ok.body.owner.two_factor_enabled).toBe(true);
  });

  it('accepts a recovery code once and emails the owner', async () => {
    const { email, recoveryCodes } = await ownerWithTwoFactor();
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/);
    const first = await challenge(email);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: first, recovery_code: recoveryCodes[0].toUpperCase() })
      .expect(200);
    expect(lastEmailTo(email).text).toMatch(/You have 9 left/);
    const second = await challenge(email);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: second, recovery_code: recoveryCodes[0] })
      .expect(401, /invalid_code/);
  });

  it('ends a challenge after 5 wrong codes, even if the same token is sent again', async () => {
    const { email, secret, step } = await ownerWithTwoFactor();
    const token = await challenge(email);
    for (let i = 0; i < 5; i++) {
      await server()
        .post('/api/owner/auth/2fa')
        .set(CSRF)
        .send({ challenge_token: token, code: '000000' })
        .expect(401, /invalid_code/);
    }
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: token, code: totpCode(secret, step + 1) })
      .expect(401, /challenge_expired/);
  });

  it('ends a challenge after 5 minutes', async () => {
    const { email, recoveryCodes } = await ownerWithTwoFactor();
    const token = await challenge(email);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: token, recovery_code: recoveryCodes[0] })
      .expect(401, /challenge_expired/);
  });

  it('signs out other sessions when 2FA is turned on and off', async () => {
    const email = await createOwner();
    const other = await signIn(email);
    const { agent } = await signIn(email);
    const setup = await agent
      .post('/api/owner/me/2fa/setup')
      .set(CSRF)
      .send({ password: PASSWORD })
      .expect(200);
    expect(setup.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/Restrovia%3Aowner-/);
    const step = currentStep();
    await agent
      .post('/api/owner/me/2fa/enable')
      .set(CSRF)
      .send({ setup_token: setup.body.setup_token, code: totpCode(setup.body.secret, step) })
      .expect(200);
    await other.agent.get('/api/owner/me').expect(401);
    const me = await agent.get('/api/owner/me').expect(200);
    expect(me.body.owner).toMatchObject({ two_factor_enabled: true, recovery_codes_left: 10 });

    const third = await signInWithRecovery(email, me);
    await agent
      .post('/api/owner/me/2fa/disable')
      .set(CSRF)
      .send({ password: PASSWORD, code: totpCode(setup.body.secret, step + 1) })
      .expect(200);
    await third.get('/api/owner/me').expect(401);
    const off = await agent.get('/api/owner/me').expect(200);
    expect(off.body.owner.two_factor_enabled).toBe(false);
    expect(lastEmailTo(email).subject).toMatch(/is off/);
    const codes = await db
      .select()
      .from(schema.ownerRecoveryCodes)
      .where(eq(schema.ownerRecoveryCodes.ownerId, me.body.owner.id));
    expect(codes).toHaveLength(0);
  });

  it('makes new recovery codes and the old ones stop working', async () => {
    const { email, agent, recoveryCodes } = await ownerWithTwoFactor();
    const fresh = await agent
      .post('/api/owner/me/2fa/recovery-codes')
      .set(CSRF)
      .send({ password: PASSWORD, recovery_code: recoveryCodes[1] })
      .expect(200);
    expect(fresh.body.recovery_codes).toHaveLength(10);
    const old = await challenge(email);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: old, recovery_code: recoveryCodes[2] })
      .expect(401, /invalid_code/);
    const next = await challenge(email);
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: next, recovery_code: fresh.body.recovery_codes[0] })
      .expect(200);
  });
});

/** Uses up one recovery code to sign in a second device; returns its agent. */
async function signInWithRecovery(email: string, me: request.Response) {
  const owner = (await ownerByEmail(email))!;
  expect(owner.id).toBe(me.body.owner.id);
  // Recovery codes are only shown once, so make a known one for this device.
  const crypto = app.get(CryptoService);
  await db
    .insert(schema.ownerRecoveryCodes)
    .values({ ownerId: owner.id, codeHash: crypto.sha256('test2345') });
  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/api/owner/auth/login')
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  await agent
    .post('/api/owner/auth/2fa')
    .set(CSRF)
    .send({ challenge_token: login.body.challenge_token, recovery_code: 'test-2345' })
    .expect(200);
  return agent;
}

describe('passwords', () => {
  it('reset signs out every session, keeps 2FA on and works once', async () => {
    const { email, agent, recoveryCodes } = await ownerWithTwoFactor();
    await server()
      .post('/api/owner/auth/password/forgot')
      .set(CSRF)
      .send({ email })
      .expect(200, { ok: true });
    const token = linkToken(email);
    await server()
      .post('/api/owner/auth/password/reset')
      .set(CSRF)
      .send({ token, password: 'password123' })
      .expect(400, /common/);
    await server()
      .post('/api/owner/auth/password/reset')
      .set(CSRF)
      .send({ token, password: 'new tea garden 7' })
      .expect(200);
    await server()
      .post('/api/owner/auth/password/reset')
      .set(CSRF)
      .send({ token, password: 'another tea garden' })
      .expect(400, /invalid_token/);
    await agent.get('/api/owner/me').expect(401);
    expect(lastEmailTo(email).subject).toMatch(/password was changed/);

    const login = await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: 'new tea garden 7' })
      .expect(200);
    expect(login.body.status).toBe('2fa_required');
    await server()
      .post('/api/owner/auth/2fa')
      .set(CSRF)
      .send({ challenge_token: login.body.challenge_token, recovery_code: recoveryCodes[3] })
      .expect(200);
  });

  it('answers a reset request for an unknown email the same way and sends nothing', async () => {
    const sent = outbox.length;
    await server()
      .post('/api/owner/auth/password/forgot')
      .set(CSRF)
      .send({ email: newEmail() })
      .expect(200, { ok: true });
    expect(outbox.length).toBe(sent);
  });

  it('change keeps this device signed in and signs out the others', async () => {
    const email = await createOwner();
    const other = await signIn(email);
    const { agent } = await signIn(email);
    await agent
      .post('/api/owner/me/password')
      .set(CSRF)
      .send({ current_password: 'wrong', new_password: 'new tea garden 7' })
      .expect(403, /wrong_password/);
    await agent
      .post('/api/owner/me/password')
      .set(CSRF)
      .send({ current_password: PASSWORD, new_password: 'new tea garden 7' })
      .expect(200);
    await agent.get('/api/owner/me').expect(200);
    await other.agent.get('/api/owner/me').expect(401);
    await signIn(email, 'new tea garden 7');
  });

  it('change needs a code when 2FA is on', async () => {
    const { agent, recoveryCodes } = await ownerWithTwoFactor();
    await agent
      .post('/api/owner/me/password')
      .set(CSRF)
      .send({ current_password: PASSWORD, new_password: 'new tea garden 7' })
      .expect(403, /code_required/);
    await agent
      .post('/api/owner/me/password')
      .set(CSRF)
      .send({
        current_password: PASSWORD,
        new_password: 'new tea garden 7',
        recovery_code: recoveryCodes[0],
      })
      .expect(200);
  });
});

describe('change email', () => {
  it('changes the address only when the link sent to the new one is opened', async () => {
    const email = await createOwner();
    const { agent } = await signIn(email);
    const next = newEmail();
    await agent
      .post('/api/owner/me/email')
      .set(CSRF)
      .send({ password: PASSWORD, new_email: next })
      .expect(200);
    expect(lastEmailTo(email).subject).toMatch(/being changed/);
    expect((await agent.get('/api/owner/me')).body.owner.email).toBe(email);
    await server()
      .post('/api/owner/auth/verify-email')
      .set(CSRF)
      .send({ token: linkToken(next) })
      .expect(200, { email: next });
    const me = await agent.get('/api/owner/me').expect(200);
    expect(me.body.owner).toMatchObject({ email: next, email_verified: true });
    await signIn(next);
  });
});

async function adminSession(role: SystemRoleKey) {
  const crypto = app.get(CryptoService);
  const [admin] = await db
    .insert(schema.admins)
    .values({
      name: `Test ${role}`,
      email: `${role}-${randomUUID().slice(0, 8)}@restrovia.test`,
      roleId: SYSTEM_ROLE_IDS[role],
      passwordHash: await crypto.hashPassword(randomUUID()),
    })
    .returning();
  const token = crypto.randomToken();
  await db.insert(schema.adminSessions).values({
    adminId: admin.id,
    tokenHash: crypto.sha256(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { admin, token };
}

describe('passwords set by a Restrovia admin', () => {
  async function createWithPassword(email: string, password = 'temp tea garden 9') {
    const store = await registerPos(app);
    const { token } = await adminSession('sales');
    const res = await server()
      .post(`/api/admin/stores/${store.storeId}/owners`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${token}`)
      .send({ name: 'Asha', email, password })
      .expect(201);
    return { res, password };
  }

  it('creates the account with the password and makes the owner choose their own first', async () => {
    const email = newEmail();
    const { res, password } = await createWithPassword(email);
    expect(res.body).toMatchObject({ created: true, password_set: true });
    const mail = lastEmailTo(email);
    expect(mail.subject).toBe('Your Restrovia account is ready');
    expect(mail.text).not.toContain(password);
    expect(mail.text).not.toMatch(/token=/);

    const { agent, res: login } = await signIn(email, password);
    expect(login.body.owner.must_change_password).toBe(true);
    await agent.get('/api/owner/me/sessions').expect(403, /password_change_required/);
    await agent
      .post('/api/owner/me/password')
      .set(CSRF)
      .send({ current_password: password, new_password: password })
      .expect(400, /same_password/);
    await agent
      .post('/api/owner/me/password')
      .set(CSRF)
      .send({ current_password: password, new_password: PASSWORD })
      .expect(200);
    const me = await agent.get('/api/owner/me').expect(200);
    expect(me.body.owner.must_change_password).toBe(false);
    await agent.get('/api/owner/me/sessions').expect(200);
  });

  it('refuses a weak password when creating the account', async () => {
    const email = newEmail();
    const store = await registerPos(app);
    const { token } = await adminSession('support');
    await server()
      .post(`/api/admin/stores/${store.storeId}/owners`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${token}`)
      .send({ name: 'Asha', email, password: 'password123' })
      .expect(400, /common/);
    expect(await ownerByEmail(email)).toBeUndefined();
  });

  it('leaves an existing owner’s password alone when linking another store', async () => {
    const email = await createOwner();
    const { res } = await createWithPassword(email);
    expect(res.body).toMatchObject({ created: false, password_set: false });
    await signIn(email);
  });

  it('lets support set a new password: sessions end, links stop, the lock lifts', async () => {
    const email = await createOwner();
    const { agent } = await signIn(email);
    const owner = (await ownerByEmail(email))!;
    await server().post('/api/owner/auth/password/forgot').set(CSRF).send({ email }).expect(200);
    const resetLink = linkToken(email);
    await db
      .update(schema.owners)
      .set({ lockedUntil: new Date(Date.now() + 10 * 60_000) })
      .where(eq(schema.owners.id, owner.id));

    const sales = await adminSession('sales');
    await server()
      .post(`/api/admin/owners/${owner.id}/password`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${sales.token}`)
      .send({ password: 'support set 4321' })
      .expect(403);
    const support = await adminSession('support');
    const res = await server()
      .post(`/api/admin/owners/${owner.id}/password`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${support.token}`)
      .send({ password: 'support set 4321' })
      .expect(200);
    expect(res.body.owner).toMatchObject({ must_change_password: true, locked: false });

    await agent.get('/api/owner/me').expect(401);
    expect(lastEmailTo(email).subject).toBe('Restrovia support set a new password for you');
    await server()
      .post('/api/owner/auth/password/reset')
      .set(CSRF)
      .send({ token: resetLink, password: 'my own tea garden' })
      .expect(400, /invalid_token/);
    await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(401);
    const login = await signIn(email, 'support set 4321');
    expect(login.res.body.owner.must_change_password).toBe(true);
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'owner.set_password'),
          eq(schema.adminAuditLog.targetId, owner.id),
        ),
      );
    expect(audit).toHaveLength(1);
  });
});

describe('admin owner tools', () => {
  it('lets support reset an owner’s 2FA with a reason, and refuses sales', async () => {
    const { email, agent } = await ownerWithTwoFactor();
    const owner = (await ownerByEmail(email))!;
    const sales = await adminSession('sales');
    await server()
      .post(`/api/admin/owners/${owner.id}/reset-2fa`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${sales.token}`)
      .send({ reason: 'Lost phone, verified by callback' })
      .expect(403, /permission_denied/);

    const support = await adminSession('support');
    const list = await server()
      .get(`/api/admin/owners?search=${encodeURIComponent(email)}`)
      .set('Cookie', `rv_admin=${support.token}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ email, two_factor_enabled: true });

    const res = await server()
      .post(`/api/admin/owners/${owner.id}/reset-2fa`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${support.token}`)
      .send({ reason: 'Lost phone, verified by callback' })
      .expect(200);
    expect(res.body.owner.two_factor_enabled).toBe(false);
    await agent.get('/api/owner/me').expect(401);
    expect(lastEmailTo(email).subject).toMatch(/reset by Restrovia support/);
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.action, 'owner.2fa_reset'),
          eq(schema.adminAuditLog.targetId, owner.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toEqual({ reason: 'Lost phone, verified by callback' });
    const login = await signIn(email);
    expect(login.res.body.status).toBe('ok');
  });

  it('disabling an owner signs them out and stops sign-in', async () => {
    const email = await createOwner();
    const { agent } = await signIn(email);
    const owner = (await ownerByEmail(email))!;
    const support = await adminSession('support');
    await server()
      .post(`/api/admin/owners/${owner.id}/disable`)
      .set(ADMIN_CSRF)
      .set('Cookie', `rv_admin=${support.token}`)
      .send({ reason: 'Requested by the owner' })
      .expect(200);
    await agent.get('/api/owner/me').expect(401);
    await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(401, /invalid_credentials/);
  });
});

describe('security events', () => {
  it('lists the owner’s recent sign-ins and changes', async () => {
    const email = await createOwner();
    await server()
      .post('/api/owner/auth/login')
      .set(CSRF)
      .send({ email, password: 'wrong password' })
      .expect(401);
    const { agent } = await signIn(email);
    const res = await agent.get('/api/owner/me/security-events').expect(200);
    expect(res.body.events.map((e: { action: string }) => e.action)).toEqual([
      'owner.login',
      'owner.login_failed',
      'owner.login',
      'owner.account_setup',
      'owner.created',
    ]);
  });
});
