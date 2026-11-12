/** The café list for many outlets, and the All outlets report with its CSV file. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import { LicensingService } from '../src/pos/licensing.service.js';
import {
  createTestApp,
  eventsBody,
  orderEvent,
  orderSnapshot,
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
/** 14:00 in India on Tuesday 20 October 2026. */
const FIXED_NOW = new Date('2026-10-20T08:30:00Z');
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);

type Pos = PosIdentity & { storeId: string };

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
  vi.restoreAllMocks();
});

const fixNow = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
};

async function signedInOwner() {
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
  return { agent, owner };
}

async function cafe(
  ownerId: string | null,
  name: string,
  opts: { role?: 'owner' | 'manager'; currency?: string } = {},
): Promise<Pos> {
  const pos = await registerPos(app);
  await db
    .update(schema.stores)
    .set({ name, currency: opts.currency ?? 'INR' })
    .where(eq(schema.stores.id, pos.storeId));
  if (ownerId) {
    await db
      .insert(schema.storeMembers)
      .values({ storeId: pos.storeId, ownerId, role: opts.role ?? 'owner' });
  }
  return pos;
}

async function sendOrders(pos: Pos, snapshots: ReturnType<typeof orderSnapshot>[]) {
  await posCall(
    app,
    pos,
    'POST',
    '/api/pos/events',
    eventsBody(
      pos,
      snapshots.map((s) => orderEvent(s)),
    ),
  ).expect(200);
}

/** Queries the API sends to Postgres while `run` is going. */
async function countQueries(run: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(Pool.prototype, 'query');
  const before = spy.mock.calls.length;
  await run();
  const n = spy.mock.calls.length - before;
  spy.mockRestore();
  return n;
}

describe('café list', () => {
  it('uses the same number of queries for two cafés as for six', async () => {
    const few = await signedInOwner();
    for (const name of ['A', 'B']) await cafe(few.owner.id, name);
    const many = await signedInOwner();
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) await cafe(many.owner.id, name);

    const two = await countQueries(() => few.agent.get('/api/owner/stores').expect(200));
    const six = await countQueries(() => many.agent.get('/api/owner/stores').expect(200));
    expect(two).toBeGreaterThan(0);
    expect(six).toBe(two);
  });

  it('gives each café its own today, role and licence', async () => {
    fixNow();
    const { agent, owner } = await signedInOwner();
    const tea = await cafe(owner.id, 'Tea House');
    const bakery = await cafe(owner.id, 'Bakery', { role: 'manager' });
    await sendOrders(tea, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '09:00'), total: 315 }),
      orderSnapshot(2, { createdAt: ist('2026-10-19', '09:00'), total: 999 }),
    ]);

    const res = await agent.get('/api/owner/stores').expect(200);
    expect(res.body.stores.map((s: { name: string }) => s.name)).toEqual(['Bakery', 'Tea House']);
    const [b, t] = res.body.stores;
    expect(b).toMatchObject({
      id: bakery.storeId,
      role: 'manager',
      today: { business_date: '2026-10-20', gross_sales: '0.00', bills_count: 0 },
    });
    expect(t).toMatchObject({
      id: tea.storeId,
      role: 'owner',
      today: { business_date: '2026-10-20', gross_sales: '315.00', bills_count: 1 },
    });
    const licensing = app.get(LicensingService);
    for (const s of res.body.stores) {
      const one = await licensing.stateFor(s.id);
      expect(s.licence).toEqual({ status: one.status, ends_at: one.endsAt.toISOString() });
    }
  });
});

describe('licence state for many cafés', () => {
  it('matches one café at a time for trial, active, ended, suspended and blocked stores', async () => {
    const licensing = app.get(LicensingService);
    const now = new Date();
    const day = 86_400_000;
    const ids = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(async () => (await registerPos(app)).storeId),
    );
    const [trial, active, ended, suspended, none, blocked] = ids;
    await db.delete(schema.subscriptions);
    await db.insert(schema.subscriptions).values([
      {
        storeId: trial,
        status: 'trial',
        trialEndsAt: new Date(now.getTime() + 5 * day),
      },
      {
        storeId: active,
        status: 'active',
        currentPeriodEnd: new Date(now.getTime() + 20 * day),
      },
      {
        storeId: ended,
        status: 'cancelled',
        currentPeriodEnd: new Date(now.getTime() - 3 * day),
      },
      {
        storeId: suspended,
        status: 'suspended',
        currentPeriodEnd: new Date(now.getTime() + 20 * day),
      },
      {
        storeId: blocked,
        status: 'active',
        currentPeriodEnd: new Date(now.getTime() + 20 * day),
      },
    ]);
    // Blocking only stops cloud access; the café keeps billing.
    await db
      .update(schema.stores)
      .set({ status: 'suspended' })
      .where(eq(schema.stores.id, blocked));

    const many = await licensing.stateForMany([...ids, randomUUID()], now);
    expect(many.size).toBe(7);
    for (const id of ids) {
      expect(many.get(id)).toEqual(await licensing.stateFor(id, now));
    }
    expect(many.get(trial)!.status).toBe('trial');
    expect(many.get(active)!.status).toBe('active');
    expect(many.get(ended)!.status).toBe('inactive');
    expect(many.get(suspended)!.status).toBe('inactive');
    expect(many.get(none)!.status).toBe('inactive');
    expect(many.get(blocked)!.status).toBe('active');
  });
});

describe('all outlets', () => {
  beforeEach(fixNow);

  async function chain() {
    const { agent, owner } = await signedInOwner();
    const tea = await cafe(owner.id, 'Tea House');
    const bakery = await cafe(owner.id, 'Bakery', { role: 'manager' });
    const dubai = await cafe(owner.id, 'Dubai Mall', { currency: 'AED' });
    const stranger = await signedInOwner();
    const notMine = await cafe(stranger.owner.id, 'Not Mine');

    await sendOrders(tea, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '09:00'), total: 315 }),
      orderSnapshot(2, { createdAt: ist('2026-10-20', '13:00'), total: 500 }),
      // A week ago: before 14:00 counts for "same time last week", after it doesn't.
      orderSnapshot(3, { createdAt: ist('2026-10-13', '12:00'), total: 400 }),
      orderSnapshot(4, { createdAt: ist('2026-10-13', '18:00'), total: 1000 }),
      orderSnapshot(5, { createdAt: ist('2026-10-01', '10:00'), total: 200 }),
    ]);
    await sendOrders(bakery, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '10:00'), total: 100 }),
      orderSnapshot(2, { createdAt: ist('2026-10-15', '10:00'), total: 250 }),
    ]);
    await sendOrders(dubai, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '11:00'), total: 80 }),
    ]);
    await sendOrders(notMine, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '11:00'), total: 9999 }),
    ]);
    return { agent, tea, bakery, dubai, notMine };
  }

  it('lists every café linked to the person, with the range and today against last week', async () => {
    const { agent, tea, bakery, dubai, notMine } = await chain();
    const res = await agent.get('/api/owner/outlets?from=2026-10-13&to=2026-10-20').expect(200);

    expect(res.body).toMatchObject({ from: '2026-10-13', to: '2026-10-20' });
    const ids = res.body.outlets.map((o: { id: string }) => o.id);
    expect(ids).toEqual([bakery.storeId, dubai.storeId, tea.storeId]);
    expect(ids).not.toContain(notMine.storeId);

    const teaRow = res.body.outlets[2];
    expect(teaRow).toMatchObject({
      name: 'Tea House',
      role: 'owner',
      currency: 'INR',
      today: { business_date: '2026-10-20', gross_sales: '815.00', bills_count: 2 },
      last_week: { business_date: '2026-10-13', gross_sales: '400.00', bills_count: 1 },
    });
    expect(teaRow.range).toMatchObject({
      gross_sales: '2215.00',
      bills_count: 4,
      orders_count: 4,
      avg_bill: '553.75',
    });
    expect(res.body.outlets[0]).toMatchObject({
      role: 'manager',
      range: { gross_sales: '350.00', bills_count: 2 },
    });

    expect(res.body.totals).toEqual([
      expect.objectContaining({
        currency: 'AED',
        outlets: 1,
        today: { gross_sales: '80.00', bills_count: 1 },
        range: expect.objectContaining({ gross_sales: '80.00' }),
      }),
      expect.objectContaining({
        currency: 'INR',
        outlets: 2,
        today: { gross_sales: '915.00', bills_count: 3 },
        last_week: { gross_sales: '400.00', bills_count: 1 },
        range: expect.objectContaining({ gross_sales: '2565.00', bills_count: 6 }),
      }),
    ]);
  });

  it('defaults to today and checks the range', async () => {
    const { agent } = await chain();
    const today = await agent.get('/api/owner/outlets').expect(200);
    expect(today.body).toMatchObject({ from: '2026-10-20', to: '2026-10-20' });
    expect(today.body.totals[1].range.gross_sales).toBe('915.00');

    await agent.get('/api/owner/outlets?from=2026-10-21').expect(400, /future_date/);
    await agent
      .get('/api/owner/outlets?from=2026-10-20&to=2026-10-19')
      .expect(400, /invalid_range/);
    await agent
      .get('/api/owner/outlets?from=2024-10-19&to=2026-10-20')
      .expect(400, /range_too_long/);
    await agent.get('/api/owner/outlets?from=2026-02-30').expect(400);
    await agent.get('/api/owner/outlets?from=2024-10-20&to=2026-10-20').expect(200);
  });

  it('answers an empty list to someone with no café, and 401 without a session', async () => {
    const { agent } = await signedInOwner();
    const res = await agent.get('/api/owner/outlets').expect(200);
    expect(res.body).toMatchObject({ outlets: [], totals: [] });
    await request(app.getHttpServer()).get('/api/owner/outlets').expect(401);
    await request(app.getHttpServer()).get('/api/owner/outlets.csv').expect(401);
  });

  it('downloads one row per café and a total per currency', async () => {
    const { agent, tea } = await chain();
    await db
      .update(schema.stores)
      .set({ name: '=HYPERLINK("x")' })
      .where(eq(schema.stores.id, tea.storeId));
    const res = await agent
      .get('/api/owner/outlets.csv?from=2026-10-13&to=2026-10-20')
      .buffer(true)
      .parse((r, done) => {
        let body = '';
        r.on('data', (c: Buffer) => (body += c.toString('utf8')));
        r.on('end', () => done(null, body));
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('outlets-2026-10-13-to-2026-10-20.csv');
    const lines = (res.body as string)
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines.slice(0, 3)).toEqual(['Report,All outlets', 'From,2026-10-13', 'To,2026-10-20']);
    expect(lines[4]).toBe(
      'Café,Code,Currency,Orders,Cancelled,Bills,Gross sales,Net sales,Tax,Discounts,Average bill',
    );
    expect(lines).toHaveLength(5 + 3 + 2);
    expect(lines.some((l) => l.startsWith(`"'=HYPERLINK(""x"")",`))).toBe(true);
    expect(lines.at(-2)).toMatch(/^All outlets \(AED\),,AED,1,0,1,80\.00,/);
    expect(lines.at(-1)).toMatch(/^All outlets \(INR\),,INR,6,0,6,2565\.00,/);
  });
});
