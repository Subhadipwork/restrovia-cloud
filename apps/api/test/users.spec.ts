/** Admin user management: invites, edits, password resets, sessions, my account, lockout rules. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
import { currentStep, totpCode } from '../src/crypto/totp.js';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { EmailService, type EmailMessage } from '../src/email/email.service.js';
import { createTestApp, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let outbox: EmailMessage[];
const CSRF = { 'X-Restrovia-Admin': '1' };
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a much better passphrase';

type Agent = ReturnType<typeof request.agent>;
let sup: Awaited<ReturnType<typeof signIn>>;
let admin: Awaited<ReturnType<typeof signIn>>;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  app = await createTestApp(url);
  outbox = app.get(EmailService).outbox;
  sup = await signIn(SYSTEM_ROLE_IDS.super_admin);
  admin = await signIn(SYSTEM_ROLE_IDS.admin);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function signIn(roleId: string) {
  const email = `admin-${randomUUID().slice(0, 8)}@restrovia.test`;
  const [row] = await db
    .insert(schema.admins)
    .values({
      name: `Test ${randomUUID().slice(0, 6)}`,
      email,
      roleId,
      passwordHash: await app.get(CryptoService).hashPassword(PASSWORD),
    })
    .returning();
  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/api/admin/auth/login')
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  await agent
    .post('/api/admin/auth/setup-2fa')
    .set(CSRF)
    .set('User-Agent', 'Test browser')
    .send({ setup_token: login.body.setup_token, code: totpCode(login.body.secret, currentStep()) })
    .expect(200);
  return { agent, id: row!.id, email, secret: login.body.secret as string };
}

/** The token in the newest email to this address. */
function linkTo(email: string, path: string): string {
  const mail = outbox.filter((m) => m.to === email).at(-1);
  const match = mail?.text.match(new RegExp(`${path}\\?token=([\\w-]+)`));
  if (!match) throw new Error(`no ${path} link emailed to ${email}`);
  return decodeURIComponent(match[1]!);
}

const invite = (agent: Agent, role = 'manager', email = `new-${randomUUID().slice(0, 8)}@x.test`) =>
  agent.post('/api/admin/admins').set(CSRF).send({ name: 'New Person', email, role });

const auditActions = async (targetId: string) =>
  (
    await db
      .select({ action: schema.adminAuditLog.action })
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, targetId))
  ).map((r) => r.action);

describe('invites', () => {
  it('emails a link; the person chooses a password, then sets up 2FA at sign-in', async () => {
    const email = `invitee-${randomUUID().slice(0, 6)}@x.test`;
    const res = await invite(sup.agent, 'manager', email).expect(201);
    expect(res.body).toMatchObject({ status: 'invited', role: 'manager' });
    const mail = outbox.filter((m) => m.to === email).at(-1)!;
    expect(mail.subject).toMatch(/invited/);
    expect(mail.text).toMatch(/as Manager/);
    const token = linkTo(email, '/accept-invite');

    const anon = request.agent(app.getHttpServer());
    const info = await anon.get('/api/admin/auth/invite').query({ token }).expect(200);
    expect(info.body).toEqual({ name: 'New Person', email });
    await anon
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email, password: 'anything at all' })
      .expect(401);

    const weak = await anon
      .post('/api/admin/auth/accept-invite')
      .set(CSRF)
      .send({ token, password: 'password1234' })
      .expect(400);
    expect(weak.body.error).toBe('weak_password');
    await anon
      .post('/api/admin/auth/accept-invite')
      .set(CSRF)
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
    await anon
      .post('/api/admin/auth/accept-invite')
      .set(CSRF)
      .send({ token, password: NEW_PASSWORD })
      .expect(401);

    const login = await anon
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email, password: NEW_PASSWORD })
      .expect(200);
    expect(login.body.status).toBe('setup_required');
    expect(await auditActions(res.body.id)).toEqual(
      expect.arrayContaining(['admin.invite', 'admin.invite_accepted']),
    );
  });

  it('resending makes the old link stop working; cancelling frees the email', async () => {
    const email = `resend-${randomUUID().slice(0, 6)}@x.test`;
    const { body } = await invite(sup.agent, 'support', email).expect(201);
    const first = linkTo(email, '/accept-invite');
    await sup.agent.post(`/api/admin/admins/${body.id}/resend-invite`).set(CSRF).expect(200);
    const second = linkTo(email, '/accept-invite');
    expect(second).not.toBe(first);
    await request(app.getHttpServer())
      .get('/api/admin/auth/invite')
      .query({ token: first })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/auth/invite')
      .query({ token: second })
      .expect(200);

    await sup.agent.post(`/api/admin/admins/${body.id}/cancel-invite`).set(CSRF).expect(200);
    await sup.agent.get(`/api/admin/admins/${body.id}`).expect(404);
    await request(app.getHttpServer())
      .get('/api/admin/auth/invite')
      .query({ token: second })
      .expect(401);
    await invite(sup.agent, 'support', email).expect(201);
  });

  it('limits invite emails per person per hour', async () => {
    const { body } = await invite(sup.agent).expect(201);
    await sup.agent.post(`/api/admin/admins/${body.id}/resend-invite`).set(CSRF).expect(200);
    await sup.agent.post(`/api/admin/admins/${body.id}/resend-invite`).set(CSRF).expect(200);
    const res = await sup.agent.post(`/api/admin/admins/${body.id}/resend-invite`).set(CSRF);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('too_many_emails');
  });

  it('refuses a duplicate email and roles above yours', async () => {
    const res = await invite(sup.agent, 'support', admin.email).expect(409);
    expect(res.body.error).toBe('email_in_use');
    expect((await invite(admin.agent, 'super_admin')).body.error).toBe('role_above_yours');
  });
});

describe('editing people', () => {
  it('changes name and role, applied on the person’s next request, and audits both', async () => {
    const person = await signIn(SYSTEM_ROLE_IDS.sales);
    await person.agent.get('/api/admin/tickets').expect(403);
    const res = await admin.agent
      .patch(`/api/admin/admins/${person.id}`)
      .set(CSRF)
      .send({ name: 'Renamed Person', role: 'support' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Renamed Person', role: 'support' });
    await person.agent.get('/api/admin/tickets').expect(200);
    const [audit] = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.targetId, person.id),
          eq(schema.adminAuditLog.action, 'admin.role_change'),
        ),
      );
    expect(audit?.details).toMatchObject({
      name: { from: expect.any(String), to: 'Renamed Person' },
      role: { from: 'sales', to: 'support' },
    });
  });

  it('won’t change your own role, or anyone above you', async () => {
    const own = await admin.agent
      .patch(`/api/admin/admins/${admin.id}`)
      .set(CSRF)
      .send({ role: 'manager' })
      .expect(400);
    expect(own.body.error).toBe('cannot_change_own_role');
    const above = await admin.agent
      .patch(`/api/admin/admins/${sup.id}`)
      .set(CSRF)
      .send({ name: 'Nope' })
      .expect(403);
    expect(above.body.error).toBe('admin_above_yours');
  });

  it('shows a person’s permissions, sessions and recent activity', async () => {
    const person = await signIn(SYSTEM_ROLE_IDS.manager);
    await person.agent.get('/api/admin/stores').expect(200);
    const res = await sup.agent.get(`/api/admin/admins/${person.id}`).expect(200);
    expect(res.body.admin).toMatchObject({ role: 'manager', status: 'active', two_factor: true });
    expect(res.body.admin.permissions).toContain('leads.export');
    expect(res.body.manageable).toBe(true);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].user_agent).toBe('Test browser');
    expect(res.body.activity.map((a: { action: string }) => a.action)).toContain('admin.login');
    const fromAdmin = await admin.agent.get(`/api/admin/admins/${sup.id}`).expect(200);
    expect(fromAdmin.body.manageable).toBe(false);
  });

  it('signs a person out everywhere and disables them', async () => {
    const person = await signIn(SYSTEM_ROLE_IDS.support);
    const res = await sup.agent
      .post(`/api/admin/admins/${person.id}/end-sessions`)
      .set(CSRF)
      .expect(200);
    expect(res.body.ended).toBe(1);
    await person.agent.get('/api/admin/auth/me').expect(401);
    await sup.agent.post(`/api/admin/admins/${person.id}/disable`).set(CSRF).expect(200);
    await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: person.email, password: PASSWORD })
      .expect(401);
  });
});

describe('password resets', () => {
  it('an admin can send a reset link; using it ends every session', async () => {
    const person = await signIn(SYSTEM_ROLE_IDS.sales);
    await sup.agent
      .post(`/api/admin/admins/${person.id}/send-password-reset`)
      .set(CSRF)
      .expect(200);
    const token = linkTo(person.email, '/reset-password');
    await request(app.getHttpServer())
      .post('/api/admin/auth/reset-password')
      .set(CSRF)
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
    await person.agent.get('/api/admin/auth/me').expect(401);
    const old = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: person.email, password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: person.email, password: NEW_PASSWORD });
    expect(fresh.body.error).toBe('code_required');
    expect(outbox.filter((m) => m.to === person.email).at(-1)!.subject).toMatch(/changed/);
  });

  it('forgot password answers the same whether or not the email is an admin', async () => {
    const person = await signIn(SYSTEM_ROLE_IDS.sales);
    const before = outbox.length;
    const unknown = await request(app.getHttpServer())
      .post('/api/admin/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'nobody@nowhere.test' })
      .expect(200);
    const known = await request(app.getHttpServer())
      .post('/api/admin/auth/forgot-password')
      .set(CSRF)
      .send({ email: person.email })
      .expect(200);
    expect(unknown.body).toEqual(known.body);
    await new Promise((r) => setTimeout(r, 50));
    expect(outbox.length).toBe(before + 1);
    expect(linkTo(person.email, '/reset-password')).toBeTruthy();
  });

  it('refuses an expired or reused link', async () => {
    const person = await signIn(SYSTEM_ROLE_IDS.sales);
    await sup.agent
      .post(`/api/admin/admins/${person.id}/send-password-reset`)
      .set(CSRF)
      .expect(200);
    const token = linkTo(person.email, '/reset-password');
    await db
      .update(schema.adminTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.adminTokens.adminId, person.id));
    const res = await request(app.getHttpServer())
      .post('/api/admin/auth/reset-password')
      .set(CSRF)
      .send({ token, password: NEW_PASSWORD })
      .expect(401);
    expect(res.body.error).toBe('invalid_link');
  });
});

describe('my account', () => {
  it('changes my password with the current one, keeping this session and ending the others', async () => {
    const me = await signIn(SYSTEM_ROLE_IDS.support);
    const other = request.agent(app.getHttpServer());
    // A second session for the same person, made directly so no new 2FA code is needed.
    const [session] = await db
      .select()
      .from(schema.adminSessions)
      .where(eq(schema.adminSessions.adminId, me.id));
    const token = app.get(CryptoService).randomToken(32);
    await db.insert(schema.adminSessions).values({
      adminId: me.id,
      tokenHash: app.get(CryptoService).sha256(token),
      expiresAt: session!.expiresAt,
    });
    await other.get('/api/admin/auth/me').set('Cookie', `rv_admin=${token}`).expect(200);

    const account = await me.agent.get('/api/admin/account').expect(200);
    expect(account.body.sessions).toHaveLength(2);
    expect(account.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const wrong = await me.agent
      .post('/api/admin/account/password')
      .set(CSRF)
      .send({ current_password: 'not it at all', new_password: NEW_PASSWORD })
      .expect(401);
    expect(wrong.body.error).toBe('wrong_password');
    const ok = await me.agent
      .post('/api/admin/account/password')
      .set(CSRF)
      .send({ current_password: PASSWORD, new_password: NEW_PASSWORD })
      .expect(200);
    expect(ok.body.other_sessions_ended).toBe(1);
    await me.agent.get('/api/admin/auth/me').expect(200);
    await other.get('/api/admin/auth/me').set('Cookie', `rv_admin=${token}`).expect(401);
  });

  it('renames me and ends one of my sessions', async () => {
    const me = await signIn(SYSTEM_ROLE_IDS.sales);
    const res = await me.agent
      .patch('/api/admin/account')
      .set(CSRF)
      .send({ name: 'New Name' })
      .expect(200);
    expect(res.body.name).toBe('New Name');
    const { sessions } = (await me.agent.get('/api/admin/account').expect(200)).body;
    await me.agent.delete(`/api/admin/account/sessions/${sessions[0].id}`).set(CSRF).expect(200);
    await me.agent.get('/api/admin/auth/me').expect(401);
  });

  it('restarting 2FA needs the password and a current code, then signs me out', async () => {
    const me = await signIn(SYSTEM_ROLE_IDS.sales);
    const bad = await me.agent
      .post('/api/admin/account/2fa/restart')
      .set(CSRF)
      .send({ password: PASSWORD, code: '000000' })
      .expect(401);
    expect(bad.body.error).toBe('invalid_code');
    await me.agent
      .post('/api/admin/account/2fa/restart')
      .set(CSRF)
      .send({ password: PASSWORD, code: totpCode(me.secret, currentStep()) })
      .expect(200);
    await me.agent.get('/api/admin/auth/me').expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .set(CSRF)
      .send({ email: me.email, password: PASSWORD })
      .expect(200);
    expect(login.body.status).toBe('setup_required');
  });
});

describe('never locked out', () => {
  it('won’t disable, demote or reset the last Super admin who can sign in', async () => {
    // Only `sup` has 2FA among Super admins; the acting Super admin loses theirs mid-session.
    const actor = await signIn(SYSTEM_ROLE_IDS.super_admin);
    await db
      .update(schema.admins)
      .set({ totpSecretEnc: null })
      .where(eq(schema.admins.id, actor.id));
    for (const call of [
      () => actor.agent.post(`/api/admin/admins/${sup.id}/disable`).set(CSRF),
      () => actor.agent.post(`/api/admin/admins/${sup.id}/reset-2fa`).set(CSRF),
      () => actor.agent.patch(`/api/admin/admins/${sup.id}`).set(CSRF).send({ role: 'admin' }),
    ]) {
      const res = await call();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('last_super_admin');
    }
    const second = await signIn(SYSTEM_ROLE_IDS.super_admin);
    await second.agent.post(`/api/admin/admins/${actor.id}/disable`).set(CSRF).expect(200);
  });
});
