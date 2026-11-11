/** Linking a café to the signed-in person with the 6-digit code its POS shows. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import {
  createTestApp,
  posCall,
  registerPos,
  resetDatabase,
  testDatabaseUrl,
  type PosIdentity,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const CSRF = { 'X-Restrovia-Owner': '1' };
const PASSWORD = 'tea garden 42';

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

afterEach(() => {
  vi.useRealTimers();
});

async function signedIn() {
  const crypto = app.get(CryptoService);
  const [owner] = await db
    .insert(schema.owners)
    .values({
      name: 'Asha',
      email: `owner-${randomUUID().slice(0, 8)}@restrovia.test`,
      passwordHash: await crypto.hashPassword(PASSWORD),
    })
    .returning();
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/owner/auth/login')
    .set(CSRF)
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  return { owner, agent };
}

async function codeFor(pos: PosIdentity): Promise<string> {
  const res = await posCall(app, pos, 'POST', '/api/pos/pairing-code', {
    revoke_devices: false,
  }).expect(200);
  return res.body.code;
}

const role = async (storeId: string, ownerId: string) =>
  (
    await db
      .select({ role: schema.storeMembers.role })
      .from(schema.storeMembers)
      .where(
        and(eq(schema.storeMembers.storeId, storeId), eq(schema.storeMembers.ownerId, ownerId)),
      )
  )[0]?.role ?? null;

const link = (agent: ReturnType<typeof request.agent>, code: string) =>
  agent.post('/api/owner/stores/link').set(CSRF).send({ code });

describe('linking a café by code', () => {
  it('makes the person an owner, once per code', async () => {
    const pos = await registerPos(app);
    const { owner, agent } = await signedIn();
    const code = await codeFor(pos);

    const res = await link(agent, code).expect(200);
    expect(res.body).toEqual({ store_id: pos.storeId, name: 'Blue Door Café', was_manager: false });
    expect(await role(pos.storeId, owner.id)).toBe('owner');
    const stores = await agent.get('/api/owner/stores').expect(200);
    expect(stores.body.stores.map((s: { id: string }) => s.id)).toEqual([pos.storeId]);

    const [stored] = await db
      .select()
      .from(schema.pairingCodes)
      .where(eq(schema.pairingCodes.storeId, pos.storeId));
    expect(stored).toMatchObject({ claimedBy: owner.id });
    expect(stored.claimedAt).toBeInstanceOf(Date);

    const other = await signedIn();
    await link(other.agent, code).expect(400, /invalid_pairing_code/);
    expect(await role(pos.storeId, other.owner.id)).toBeNull();
    // The POS lists the new owner's sign-in among its linked devices.
    const devices = await posCall(app, pos, 'GET', '/api/pos/devices').expect(200);
    expect(devices.body.devices.length).toBeGreaterThan(0);
  });

  it('turns a manager into an owner and leaves an owner’s code unused', async () => {
    const pos = await registerPos(app);
    const { owner, agent } = await signedIn();
    await db
      .insert(schema.storeMembers)
      .values({ storeId: pos.storeId, ownerId: owner.id, role: 'manager' });
    const res = await link(agent, await codeFor(pos)).expect(200);
    expect(res.body.was_manager).toBe(true);
    expect(await role(pos.storeId, owner.id)).toBe('owner');

    const code = await codeFor(pos);
    await link(agent, code).expect(409, /already_linked/);
    const someoneElse = await signedIn();
    await link(someoneElse.agent, code).expect(200);
  });

  it('refuses expired codes and deleted cafés', async () => {
    const pos = await registerPos(app);
    const { agent } = await signedIn();
    const code = await codeFor(pos);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    await link(agent, code).expect(400, /invalid_pairing_code/);
    vi.useRealTimers();

    const gone = await registerPos(app);
    const goneCode = await codeFor(gone);
    await db
      .update(schema.stores)
      .set({ status: 'deleted' })
      .where(eq(schema.stores.id, gone.storeId));
    await link(agent, goneCode).expect(400, /invalid_pairing_code/);
  });

  it('pauses linking after five wrong codes in 15 minutes', async () => {
    const pos = await registerPos(app);
    const { owner, agent } = await signedIn();
    const code = await codeFor(pos);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await link(agent, wrong).expect(400);
    await link(agent, code).expect(429, /too_many_codes/);
    expect(await role(pos.storeId, owner.id)).toBeNull();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    // The pause is over, but the code has expired meanwhile.
    await link(agent, code).expect(400, /invalid_pairing_code/);

    const events = await db
      .select({ action: schema.ownerSecurityEvents.action })
      .from(schema.ownerSecurityEvents)
      .where(eq(schema.ownerSecurityEvents.ownerId, owner.id));
    expect(events.filter((e) => e.action === 'owner.link_failed')).toHaveLength(6);
  });

  it('lets only one of two people racing for a code win', async () => {
    const pos = await registerPos(app);
    const a = await signedIn();
    const b = await signedIn();
    const code = await codeFor(pos);
    const results = await Promise.all([link(a.agent, code), link(b.agent, code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const owners = await db
      .select()
      .from(schema.storeMembers)
      .where(eq(schema.storeMembers.storeId, pos.storeId));
    expect(owners).toHaveLength(1);
  });

  it('needs a signed-in person, the CSRF header and six digits', async () => {
    const pos = await registerPos(app);
    const code = await codeFor(pos);
    await request(app.getHttpServer())
      .post('/api/owner/stores/link')
      .set(CSRF)
      .send({ code })
      .expect(401);
    const { agent } = await signedIn();
    await agent.post('/api/owner/stores/link').send({ code }).expect(403, /csrf/);
    await link(agent, '12345').expect(400);
    await link(agent, 'abcdef').expect(400);
  });
});
