/** Licence tokens for offline POS checks: claims, signatures, machine binding and states. */
import { createHash, randomUUID, verify } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { LicenceClaims } from '@restrovia/shared';
import * as schema from '../src/db/schema/index.js';
import { LicensingService } from '../src/pos/licensing.service.js';
import {
  createTestApp,
  posCall,
  registerPos,
  resetDatabase,
  testDatabaseUrl,
  testLicencePublicKey,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const DAY = 86_400_000;
const machine = (name: string) => createHash('sha256').update(`machine:${name}`).digest('hex');

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  app = await createTestApp(url);
  await db
    .insert(schema.plans)
    .values({ code: 'outlet_monthly', name: 'Outlet monthly', price: '999.00', interval: 'month' });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** Verifies a token exactly as the POS does and returns its claims. */
function verifyToken(token: string): LicenceClaims {
  const [body, signature] = token.split('.');
  const ok = verify(
    null,
    Buffer.from(body),
    testLicencePublicKey,
    Buffer.from(signature, 'base64url'),
  );
  if (!ok) throw new Error('bad signature');
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}

function checkIn(pos: Awaited<ReturnType<typeof registerPos>>, machineName = 'counter-pc') {
  return posCall(app, pos, 'POST', '/api/pos/licence', {
    pos_hash: pos.posHash,
    machine_id_hash: machine(machineName),
    app_version: '3.13.15',
  });
}

describe('POST /api/pos/licence', () => {
  it('signs a trial licence that must be renewed within 5 days', async () => {
    const pos = await registerPos(app);
    const res = await checkIn(pos).expect(200);
    const claims = verifyToken(res.body.token);
    expect(claims).toMatchObject({
      v: 1,
      kid: 'k1',
      pos_id: pos.posId,
      store_id: pos.storeId,
      pos_hash: pos.posHash,
      machine: machine('counter-pc'),
      status: 'trial',
      plan: null,
    });
    const iat = Date.parse(claims.iat);
    expect(Math.abs(iat - Date.now())).toBeLessThan(60_000);
    expect(Date.parse(claims.checkin_by) - iat).toBe(5 * DAY);
    expect(Date.parse(claims.grace_ends_at) - Date.parse(claims.ends_at)).toBe(DAY);
    expect(Math.round((Date.parse(claims.ends_at) - iat) / DAY)).toBe(30);
  });

  it('produces tokens that fail verification when any byte is changed', async () => {
    const pos = await registerPos(app);
    const { token } = (await checkIn(pos).expect(200)).body as { token: string };
    const [body, sig] = token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = Buffer.from(
      JSON.stringify({ ...claims, ends_at: '2099-01-01T00:00:00.000Z' }),
    ).toString('base64url');
    expect(() => verifyToken(`${forged}.${sig}`)).toThrow('bad signature');
  });

  it('binds the licence to the first computer and refuses another until support resets it', async () => {
    const pos = await registerPos(app);
    await checkIn(pos, 'counter-pc').expect(200);
    await checkIn(pos, 'counter-pc').expect(200);
    const copy = await checkIn(pos, 'someone-elses-pc').expect(409);
    expect(copy.body.error).toBe('machine_mismatch');

    await db
      .update(schema.posDevices)
      .set({ machineIdHash: null })
      .where(eq(schema.posDevices.id, pos.posId));
    const moved = await checkIn(pos, 'new-counter-pc').expect(200);
    expect(verifyToken(moved.body.token).machine).toBe(machine('new-counter-pc'));
  });

  it('marks an ended trial inactive with one day of grace from the end', async () => {
    const pos = await registerPos(app);
    const ended = new Date(Date.now() - 3 * 3_600_000);
    await db
      .update(schema.subscriptions)
      .set({ trialEndsAt: ended })
      .where(eq(schema.subscriptions.storeId, pos.storeId));
    const claims = verifyToken((await checkIn(pos).expect(200)).body.token);
    expect(claims.status).toBe('inactive');
    expect(Date.parse(claims.ends_at)).toBe(ended.getTime());
    expect(Date.parse(claims.grace_ends_at)).toBe(ended.getTime() + DAY);
  });

  it('reports a paid plan with its period end', async () => {
    const pos = await registerPos(app);
    const [plan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'outlet_monthly'));
    const end = new Date(Date.now() + 20 * DAY);
    await db
      .update(schema.subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(schema.subscriptions.storeId, pos.storeId));
    await db.insert(schema.subscriptions).values({
      storeId: pos.storeId,
      planId: plan.id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: end,
    });
    const claims = verifyToken((await checkIn(pos).expect(200)).body.token);
    expect(claims).toMatchObject({ status: 'active', plan: 'outlet_monthly' });
    expect(Date.parse(claims.ends_at)).toBe(end.getTime());
  });

  it('gives a suspended store one day of grace from the suspension', async () => {
    const pos = await registerPos(app);
    const suspendedAt = new Date(Date.now() - 2 * 3_600_000);
    await db
      .update(schema.subscriptions)
      .set({ status: 'suspended', updatedAt: suspendedAt })
      .where(eq(schema.subscriptions.storeId, pos.storeId));
    const claims = verifyToken((await checkIn(pos).expect(200)).body.token);
    expect(claims.status).toBe('inactive');
    expect(Date.parse(claims.grace_ends_at)).toBe(suspendedAt.getTime() + DAY);
  });

  it('gives no grace when billing was stopped at once', async () => {
    const pos = await registerPos(app);
    const suspendedAt = new Date(Date.now() - 60_000);
    await db
      .update(schema.subscriptions)
      .set({ status: 'suspended', graceWaived: true, updatedAt: suspendedAt })
      .where(eq(schema.subscriptions.storeId, pos.storeId));
    const claims = verifyToken((await checkIn(pos).expect(200)).body.token);
    expect(claims.status).toBe('inactive');
    expect(Date.parse(claims.grace_ends_at)).toBe(suspendedAt.getTime());
  });

  it('refuses a body for another install and an unsigned request', async () => {
    const pos = await registerPos(app);
    await posCall(app, pos, 'POST', '/api/pos/licence', {
      pos_hash: 'someone-else',
      machine_id_hash: machine('x'),
    }).expect(400);
    await posCall(app, { ...pos, apiKey: 'wrong' }, 'POST', '/api/pos/licence', {
      pos_hash: pos.posHash,
      machine_id_hash: machine('x'),
    }).expect(401);
  });
});

describe('without a signing key', () => {
  it('refuses to issue unsigned licences', async () => {
    const config = { get: (key: string) => (key === 'LICENCE_KEY_ID' ? 'k1' : undefined) };
    const service = new LicensingService(db as never, config as never);
    const pos = await registerPos(app);
    const device = await db.query.posDevices.findFirst({
      where: eq(schema.posDevices.id, pos.posId),
    });
    await expect(service.issue(device!, machine(randomUUID()), '')).rejects.toMatchObject({
      response: { error: 'licensing_not_configured' },
    });
  });
});
