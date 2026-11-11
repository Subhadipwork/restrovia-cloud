/** A café's team: owners invite managers by email, and invited people accept from the link. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { EmailService } from '../src/email/email.service.js';
import { createTestApp, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
let outbox: EmailService['outbox'];

const CSRF = { 'X-Restrovia-Owner': '1' };
const PASSWORD = 'tea garden 42';
const NEW_PASSWORD = 'river stones 77';

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

beforeEach(() => {
  outbox.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@restrovia.test`;

async function person(opts: { password?: boolean } = {}) {
  const crypto = app.get(CryptoService);
  const [owner] = await db
    .insert(schema.owners)
    .values({
      name: 'Asha',
      email: email('person'),
      passwordHash: opts.password === false ? null : await crypto.hashPassword(PASSWORD),
    })
    .returning();
  return owner;
}

async function signIn(owner: { email: string }) {
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/owner/auth/login')
    .set(CSRF)
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  return agent;
}

async function cafeWithOwner() {
  const { storeId } = await registerPos(app);
  await db.update(schema.stores).set({ name: 'Tea House' }).where(eq(schema.stores.id, storeId));
  const owner = await person();
  await db.insert(schema.storeMembers).values({ storeId, ownerId: owner.id, role: 'owner' });
  const agent = await signIn(owner);
  return { storeId, owner, agent, base: `/api/owner/stores/${storeId}/team` };
}

const tokenFrom = (mail: { text: string }) => {
  const match = mail.text.match(/\/join\?token=([\w-]+)/);
  if (!match) throw new Error(`no invite link in: ${mail.text}`);
  return match[1];
};

const events = async (ownerId: string) =>
  (
    await db
      .select({ action: schema.ownerSecurityEvents.action })
      .from(schema.ownerSecurityEvents)
      .where(eq(schema.ownerSecurityEvents.ownerId, ownerId))
      .orderBy(desc(schema.ownerSecurityEvents.id))
  ).map((e) => e.action);

describe('who can open Team', () => {
  it('lets owners in and keeps managers, strangers and signed-out people out', async () => {
    const { storeId, owner, agent, base } = await cafeWithOwner();
    const res = await agent.get(base).expect(200);
    expect(res.body.members).toEqual([
      expect.objectContaining({ owner_id: owner.id, role: 'owner', you: true, set_up: true }),
    ]);
    expect(res.body.invites).toEqual([]);

    const manager = await person();
    await db.insert(schema.storeMembers).values({ storeId, ownerId: manager.id, role: 'manager' });
    const managerAgent = await signIn(manager);
    await managerAgent.get(base).expect(403, /owner_only/);
    await managerAgent
      .post(`${base}/invites`)
      .set(CSRF)
      .send({ email: email('x') })
      .expect(403);
    // Managers still read the café itself.
    await managerAgent.get(`/api/owner/stores/${storeId}`).expect(200);

    const stranger = await signIn(await person());
    await stranger.get(base).expect(404);
    await request(app.getHttpServer()).get(base).expect(401);
    await agent
      .post(`${base}/invites`)
      .send({ email: email('x') })
      .expect(403, /csrf/);
  });
});

describe('inviting', () => {
  it('emails a link, lists the invite, and refuses members and duplicates', async () => {
    const { owner, agent, base, storeId } = await cafeWithOwner();
    const to = email('ravi');
    const res = await agent.post(`${base}/invites`).set(CSRF).send({ email: to }).expect(201);

    expect(res.body.invites).toEqual([
      expect.objectContaining({
        email: to,
        role: 'manager',
        invited_by: 'Asha',
        expired: false,
        can_resend: true,
      }),
    ]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to, subject: 'Asha invited you to Tea House on Restrovia' });
    expect(outbox[0].text).toContain('http://localhost:3200/join?token=');
    const [stored] = await db
      .select()
      .from(schema.ownerInvites)
      .where(eq(schema.ownerInvites.storeId, storeId));
    // Only the hash of the link is kept.
    expect(stored.tokenHash.toString('hex')).not.toContain(tokenFrom(outbox[0]));
    expect(await events(owner.id)).toContain('owner.manager_invited');

    await agent
      .post(`${base}/invites`)
      .set(CSRF)
      .send({ email: to.toUpperCase() })
      .expect(409, /invite_pending/);
    await agent
      .post(`${base}/invites`)
      .set(CSRF)
      .send({ email: owner.email })
      .expect(409, /already_member/);
    await agent.post(`${base}/invites`).set(CSRF).send({ email: 'not-an-email' }).expect(400);
  });

  it('allows ten invites a day per café, cancelled ones included', async () => {
    const { agent, base } = await cafeWithOwner();
    for (let i = 0; i < 10; i++) {
      const res = await agent
        .post(`${base}/invites`)
        .set(CSRF)
        .send({ email: email(`m${i}`) });
      expect(res.status).toBe(201);
      if (i % 2) await agent.delete(`${base}/invites/${res.body.invites[0].id}`).set(CSRF);
    }
    await agent
      .post(`${base}/invites`)
      .set(CSRF)
      .send({ email: email('eleventh') })
      .expect(429, /invite_limit/);
  });

  it('resends with a new link once a minute at most, and cancels', async () => {
    const { owner, agent, base } = await cafeWithOwner();
    const to = email('meera');
    const res = await agent.post(`${base}/invites`).set(CSRF).send({ email: to }).expect(201);
    const inviteId = res.body.invites[0].id;
    const first = tokenFrom(outbox[0]);

    await agent
      .post(`${base}/invites/${inviteId}/resend`)
      .set(CSRF)
      .expect(429, /resend_too_soon/);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 61_000));
    await agent.post(`${base}/invites/${inviteId}/resend`).set(CSRF).expect(200);
    expect(outbox).toHaveLength(2);
    const second = tokenFrom(outbox[1]);
    expect(second).not.toBe(first);
    vi.useRealTimers();

    const anon = request(app.getHttpServer());
    await anon.post('/api/owner/invites/preview').set(CSRF).send({ token: first }).expect(400);
    await anon.post('/api/owner/invites/preview').set(CSRF).send({ token: second }).expect(200);

    await agent.delete(`${base}/invites/${inviteId}`).set(CSRF).expect(200);
    await agent.delete(`${base}/invites/${inviteId}`).set(CSRF).expect(404);
    await anon
      .post('/api/owner/invites/preview')
      .set(CSRF)
      .send({ token: second })
      .expect(400, /invite_invalid/);
    expect(await events(owner.id)).toEqual(
      expect.arrayContaining(['owner.invite_resent', 'owner.invite_cancelled']),
    );
    // A cancelled invite no longer blocks a new one.
    await agent.post(`${base}/invites`).set(CSRF).send({ email: to }).expect(201);
  });

  it('does not touch another café’s invites', async () => {
    const mine = await cafeWithOwner();
    const theirs = await cafeWithOwner();
    const res = await theirs.agent
      .post(`${theirs.base}/invites`)
      .set(CSRF)
      .send({ email: email('z') })
      .expect(201);
    const inviteId = res.body.invites[0].id;
    await mine.agent.delete(`${mine.base}/invites/${inviteId}`).set(CSRF).expect(404);
    await mine.agent.post(`${mine.base}/invites/${inviteId}/resend`).set(CSRF).expect(404);
  });
});

describe('accepting', () => {
  async function invited(to = email('new')) {
    const cafe = await cafeWithOwner();
    await cafe.agent.post(`${cafe.base}/invites`).set(CSRF).send({ email: to }).expect(201);
    return { ...cafe, to, token: tokenFrom(outbox.at(-1)!) };
  }

  it('lets a new person choose a password and lands them in the café as a manager', async () => {
    const { storeId, to, token, agent: ownerAgent, base } = await invited();
    const anon = request.agent(app.getHttpServer());

    const preview = await anon
      .post('/api/owner/invites/preview')
      .set(CSRF)
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      store_name: 'Tea House',
      invited_by: 'Asha',
      email: to,
      role: 'manager',
      account: 'new',
    });

    await anon
      .post('/api/owner/invites/accept-new')
      .send({ token, name: 'Ravi', password: NEW_PASSWORD })
      .expect(403, /csrf/);
    await anon
      .post('/api/owner/invites/accept-new')
      .set(CSRF)
      .send({ token, name: 'Ravi', password: 'password' })
      .expect(400, /weak_password/);

    const res = await anon
      .post('/api/owner/invites/accept-new')
      .set(CSRF)
      .send({ token, name: 'Ravi', password: NEW_PASSWORD })
      .expect(200);
    expect(res.body).toMatchObject({
      store_id: storeId,
      owner: { name: 'Ravi', email: to, email_verified: true },
    });

    const stores = await anon.get('/api/owner/stores').expect(200);
    expect(stores.body.stores).toEqual([expect.objectContaining({ id: storeId, role: 'manager' })]);
    await anon.get(base).expect(403, /owner_only/);
    expect(await events(res.body.owner.id)).toEqual(
      expect.arrayContaining(['owner.created', 'owner.account_setup', 'owner.invite_accepted']),
    );

    // The link works once.
    await request(app.getHttpServer())
      .post('/api/owner/invites/accept-new')
      .set(CSRF)
      .send({ token, name: 'Again', password: NEW_PASSWORD })
      .expect(400, /invite_invalid/);
    const team = await ownerAgent.get(base).expect(200);
    expect(team.body.invites).toEqual([]);
    expect(team.body.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'manager']);
  });

  it('finishes an account that was never set up', async () => {
    const waiting = await person({ password: false });
    const { storeId, token } = await invited(waiting.email);
    const anon = request.agent(app.getHttpServer());
    const preview = await anon.post('/api/owner/invites/preview').set(CSRF).send({ token });
    expect(preview.body.account).toBe('new');
    const res = await anon
      .post('/api/owner/invites/accept-new')
      .set(CSRF)
      .send({ token, name: 'Ignored', password: NEW_PASSWORD })
      .expect(200);
    expect(res.body.owner).toMatchObject({ id: waiting.id, name: 'Asha' });
    const [member] = await db
      .select()
      .from(schema.storeMembers)
      .where(
        and(eq(schema.storeMembers.storeId, storeId), eq(schema.storeMembers.ownerId, waiting.id)),
      );
    expect(member.role).toBe('manager');
  });

  it('asks an existing account to sign in with the invited email', async () => {
    const existing = await person();
    const { storeId, token } = await invited(existing.email);
    const anon = request(app.getHttpServer());

    const preview = await anon.post('/api/owner/invites/preview').set(CSRF).send({ token });
    expect(preview.body.account).toBe('existing');
    await anon
      .post('/api/owner/invites/accept-new')
      .set(CSRF)
      .send({ token, name: 'X', password: NEW_PASSWORD })
      .expect(409, /account_exists/);
    await anon.post('/api/owner/invites/accept').set(CSRF).send({ token }).expect(401);

    const wrong = await signIn(await person());
    const refused = await wrong
      .post('/api/owner/invites/accept')
      .set(CSRF)
      .send({ token })
      .expect(403);
    expect(refused.body).toEqual({
      error: 'wrong_account',
      email: `${existing.email.slice(0, 2)}***@restrovia.test`,
    });

    const right = await signIn(existing);
    await right
      .post('/api/owner/invites/accept')
      .set(CSRF)
      .send({ token })
      .expect(200, { store_id: storeId });
    const stores = await right.get('/api/owner/stores').expect(200);
    expect(stores.body.stores.map((s: { id: string }) => s.id)).toContain(storeId);
    await right.post('/api/owner/invites/accept').set(CSRF).send({ token }).expect(400);
  });

  it('refuses an expired link', async () => {
    const { token } = await invited();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 8 * 86_400_000));
    await request(app.getHttpServer())
      .post('/api/owner/invites/preview')
      .set(CSRF)
      .send({ token })
      .expect(400, /invite_invalid/);
  });
});

describe('removing', () => {
  it('removes a manager, emails them, and never removes an owner', async () => {
    const { storeId, owner, agent, base } = await cafeWithOwner();
    const manager = await person();
    const coOwner = await person();
    await db.insert(schema.storeMembers).values([
      { storeId, ownerId: manager.id, role: 'manager' },
      { storeId, ownerId: coOwner.id, role: 'owner' },
    ]);
    const managerAgent = await signIn(manager);
    await managerAgent.get(`/api/owner/stores/${storeId}`).expect(200);

    await agent
      .delete(`${base}/members/${coOwner.id}`)
      .set(CSRF)
      .expect(403, /cannot_remove_owner/);
    await agent
      .delete(`${base}/members/${owner.id}`)
      .set(CSRF)
      .expect(403, /cannot_remove_owner/);
    await agent.delete(`${base}/members/${randomUUID()}`).set(CSRF).expect(404);

    const res = await agent.delete(`${base}/members/${manager.id}`).set(CSRF).expect(200);
    expect(res.body.members.map((m: { owner_id: string }) => m.owner_id)).not.toContain(manager.id);
    expect(outbox).toEqual([
      expect.objectContaining({
        to: manager.email,
        subject: 'You no longer have access to Tea House',
      }),
    ]);
    await managerAgent.get(`/api/owner/stores/${storeId}`).expect(404);
    expect(await events(owner.id)).toContain('owner.manager_removed');
    expect(await events(manager.id)).toContain('owner.removed_from_store');
  });
});
