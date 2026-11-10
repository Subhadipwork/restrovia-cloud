/** Owner portal store pages: membership, POS status, today's totals, live orders and order history. */
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
  eventsBody,
  orderEvent,
  orderSnapshot,
  posCall,
  registerPos,
  resetDatabase,
  sqliteTime,
  testDatabaseUrl,
  type PosIdentity,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const CSRF = { 'X-Restrovia-Owner': '1' };
const PASSWORD = 'tea garden 42';
/** 14:00 in India on 20 October 2026. */
const FIXED_NOW = new Date('2026-10-20T08:30:00Z');
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);

type Pos = PosIdentity & { storeId: string };
type Snapshot = ReturnType<typeof orderSnapshot>;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  // Listening once lets several requests run at the same time (the live-order tests need that).
  await app.listen(0);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

afterEach(() => {
  vi.useRealTimers();
});

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
    .set(CSRF)
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  return { agent, owner };
}

async function seen(
  storeId: string,
  minutesAgo: number,
  field: 'heartbeat' | 'licence' = 'heartbeat',
) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await db
    .update(schema.posDevices)
    .set(field === 'heartbeat' ? { lastHeartbeatAt: at } : { lastLicenceAt: at })
    .where(eq(schema.posDevices.storeId, storeId));
}

async function sendOrders(pos: Pos, snapshots: unknown[]) {
  await posCall(
    app,
    pos,
    'POST',
    '/api/pos/events',
    eventsBody(
      pos,
      snapshots.map((s) => orderEvent(s as Snapshot)),
    ),
  ).expect(200);
}

const cancelled = (snapshot: Snapshot) => ({
  ...snapshot,
  status: 'cancelled',
  cancelled_at: snapshot.created_at,
  bill: null,
  bills: [],
});

describe('stores and access', () => {
  it('lists only the owner’s stores and hides every other store', async () => {
    const mine = await registerPos(app);
    const other = await registerPos(app);
    const { agent } = await ownerOf(mine.storeId);
    await ownerOf(other.storeId);
    await sendOrders(mine, [orderSnapshot(1, { paidAt: null }), orderSnapshot(2, { total: 250 })]);
    await sendOrders(other, [orderSnapshot(1, { paidAt: null })]);
    await seen(mine.storeId, 2);

    const list = await agent.get('/api/owner/stores').expect(200);
    expect(list.body.stores).toHaveLength(1);
    expect(list.body.stores[0]).toMatchObject({
      id: mine.storeId,
      role: 'owner',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      online: true,
      open_orders: 1,
      today: { gross_sales: '250.00', bills_count: 1 },
      licence: { status: 'trial' },
    });

    for (const path of ['status', 'dashboard', 'live', 'orders', `orders/${randomUUID()}`]) {
      await agent.get(`/api/owner/stores/${other.storeId}/${path}`).expect(404);
    }
    await agent.get('/api/owner/stores/not-a-store/status').expect(404);
    await request(app.getHttpServer()).get(`/api/owner/stores/${mine.storeId}/status`).expect(401);
  });

  it('lets a manager use every store page', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId, 'manager');
    for (const path of ['status', 'dashboard', 'orders']) {
      await agent.get(`/api/owner/stores/${pos.storeId}/${path}`).expect(200);
    }
  });

  it('waits for an owner on a password Restrovia set to choose their own', async () => {
    const pos = await registerPos(app);
    const { agent, owner } = await ownerOf(pos.storeId);
    await db
      .update(schema.owners)
      .set({ mustChangePassword: true })
      .where(eq(schema.owners.id, owner.id));
    await agent.get('/api/owner/stores').expect(403, /password_change_required/);
  });
});

describe('POS status', () => {
  it('reports online, offline and last seen for the store and each POS', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);

    await seen(pos.storeId, 3);
    let res = await agent.get(`/api/owner/stores/${pos.storeId}/status`).expect(200);
    expect(res.body).toMatchObject({ online: true, last_order_synced_at: null });
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0]).toMatchObject({
      name: 'CAFE-PC',
      app_version: '3.13.14',
      online: true,
      live_connection: false,
    });

    await seen(pos.storeId, 20);
    res = await agent.get(`/api/owner/stores/${pos.storeId}/status`).expect(200);
    expect(res.body.online).toBe(false);
    const lastSeen = Date.parse(res.body.last_seen_at);
    expect(Date.now() - lastSeen).toBeGreaterThan(19 * 60_000);
    expect(Date.now() - lastSeen).toBeLessThan(21 * 60_000);

    // Licence check-ins keep coming when Cloud Sync is off, so they count as seen.
    await seen(pos.storeId, 2, 'licence');
    res = await agent.get(`/api/owner/stores/${pos.storeId}/status`).expect(200);
    expect(res.body.online).toBe(true);

    await sendOrders(pos, [orderSnapshot(1)]);
    res = await agent.get(`/api/owner/stores/${pos.storeId}/status`).expect(200);
    expect(res.body.last_order_synced_at).not.toBeNull();

    await db
      .update(schema.posDevices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.posDevices.storeId, pos.storeId));
    res = await agent.get(`/api/owner/stores/${pos.storeId}/status`).expect(200);
    expect(res.body).toMatchObject({ online: false, last_seen_at: null, devices: [] });
  });
});

describe('today dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  it('adds up today and compares with yesterday and last week up to the same time', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '12:00'), total: 315 }),
      orderSnapshot(2, { createdAt: ist('2026-10-20', '13:00'), total: 500, type: 'takeaway' }),
      orderSnapshot(3, { createdAt: ist('2026-10-20', '13:30'), total: 200, paidAt: null }),
      orderSnapshot(4, { createdAt: ist('2026-10-19', '12:00'), total: 100 }),
      // After 14:00, so not in "yesterday at this time".
      orderSnapshot(5, { createdAt: ist('2026-10-19', '16:00'), total: 400 }),
      orderSnapshot(6, { createdAt: ist('2026-10-13', '10:00'), total: 250 }),
    ]);

    const res = await agent.get(`/api/owner/stores/${pos.storeId}/dashboard`).expect(200);
    expect(res.body).toMatchObject({ business_date: '2026-10-20', is_today: true, open_orders: 1 });
    expect(res.body.totals).toMatchObject({
      gross_sales: '815.00',
      bills_count: 2,
      orders_count: 3,
      avg_bill: '407.50',
    });
    expect(res.body.compare.yesterday).toMatchObject({
      business_date: '2026-10-19',
      same_time: true,
      gross_sales: '100.00',
      bills_count: 1,
      orders_count: 1,
    });
    expect(res.body.compare.last_week).toMatchObject({
      business_date: '2026-10-13',
      gross_sales: '250.00',
    });
    expect(res.body.by_type).toEqual({
      dine_in: { sales: '315.00', count: 1 },
      takeaway: { sales: '500.00', count: 1 },
    });
    expect(res.body.hourly).toHaveLength(24);
    expect(res.body.hourly[0].hour).toBe(0);
    expect(res.body.hourly[12]).toEqual({ hour: 12, sales: '315.00', last_week: '0.00' });
    expect(res.body.hourly[13].sales).toBe('500.00');
    expect(res.body.hourly[10].last_week).toBe('250.00');

    // An earlier day compares whole days.
    const past = await agent
      .get(`/api/owner/stores/${pos.storeId}/dashboard?date=2026-10-19`)
      .expect(200);
    expect(past.body).toMatchObject({ is_today: false, totals: { gross_sales: '500.00' } });
    expect(past.body.compare.yesterday).toMatchObject({
      business_date: '2026-10-18',
      same_time: false,
    });

    await agent
      .get(`/api/owner/stores/${pos.storeId}/dashboard?date=2026-10-21`)
      .expect(400, /future_date/);
  });

  it('counts a 01:00 sale on the previous day when the store’s day starts at 04:00', async () => {
    const pos = await registerPos(app);
    await db
      .update(schema.stores)
      .set({ businessDayStart: '04:00' })
      .where(eq(schema.stores.id, pos.storeId));
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '01:00'), total: 120 }),
    ]);

    const today = await agent.get(`/api/owner/stores/${pos.storeId}/dashboard`).expect(200);
    expect(today.body.totals.gross_sales).toBe('0.00');
    expect(today.body.hourly[0].hour).toBe(4);
    const previous = await agent
      .get(`/api/owner/stores/${pos.storeId}/dashboard?date=2026-10-19`)
      .expect(200);
    expect(previous.body.totals.gross_sales).toBe('120.00');
    // The chart puts the late hours of the business day at the end.
    expect(previous.body.hourly[21]).toMatchObject({ hour: 1, sales: '120.00' });
  });
});

describe('live orders', () => {
  /** Answers the next orders.live command the way the POS does. */
  async function answerAsPos(pos: Pos, orders: unknown[]) {
    for (let i = 0; i < 60; i++) {
      const res = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
      const command = res.body.commands[0];
      if (command) {
        expect(command.type).toBe('orders.live');
        await posCall(app, pos, 'POST', `/api/pos/commands/${command.id}/result`, {
          version: 1,
          correlation_id: command.id,
          ok: true,
          result: { orders },
          completed_at: new Date().toISOString(),
        }).expect(200);
        return command.id as string;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('No orders.live command reached the POS');
  }

  const commandsFor = (storeId: string) =>
    db.select().from(schema.commands).where(eq(schema.commands.storeId, storeId));

  it('asks the POS, drops customer data and shares one answer for a few seconds', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await seen(pos.storeId, 1);
    const open = orderSnapshot(7, { paidAt: null, total: 420 });

    const pending = agent.get(`/api/owner/stores/${pos.storeId}/live`).then((r) => r);
    const commandId = await answerAsPos(pos, [open]);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'live', reason: null });
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).toMatchObject({
      pos_order_id: 7,
      order_number: 'A-7',
      status: 'served',
      table: 'T3',
      total: '420.00',
      items: [{ name: 'Cappuccino', quantity: '2.000', voided: false }],
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Should Not Store');
    expect(text).not.toContain('Secret street');
    expect(text).not.toContain('extra hot');

    const [stored] = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.id, commandId));
    expect(stored.result).toEqual({ count: 1 });

    await agent.get(`/api/owner/stores/${pos.storeId}/live`).expect(200);
    expect(await commandsFor(pos.storeId)).toHaveLength(1);
  });

  it('shows the synced open orders when the POS is offline', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      orderSnapshot(1, { paidAt: null, total: 300 }),
      orderSnapshot(2, { total: 150 }),
    ]);
    await seen(pos.storeId, 20);

    const res = await agent.get(`/api/owner/stores/${pos.storeId}/live`).expect(200);
    expect(res.body).toMatchObject({ source: 'synced', reason: 'offline' });
    expect(res.body.as_of).not.toBeNull();
    expect(res.body.orders.map((o: { pos_order_id: number }) => o.pos_order_id)).toEqual([1]);
    expect(res.body.orders[0].order_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await commandsFor(pos.storeId)).toHaveLength(0);
  });

  it('falls back to synced orders when the POS doesn’t answer in time', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await seen(pos.storeId, 1);
    const res = await agent.get(`/api/owner/stores/${pos.storeId}/live`).expect(200);
    expect(res.body).toMatchObject({ source: 'synced', reason: 'no_answer', orders: [] });
  });
});

describe('order history', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  it('pages, totals, filters and searches the day’s orders', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    const snapshots: unknown[] = [];
    for (let id = 1; id <= 27; id++) {
      const at = new Date(ist('2026-10-20', '09:00').getTime() + id * 60_000);
      snapshots.push(
        orderSnapshot(id, { createdAt: at, total: 100, type: id <= 3 ? 'takeaway' : 'dine_in' }),
      );
    }
    snapshots.push(
      cancelled(orderSnapshot(28, { createdAt: ist('2026-10-20', '10:00'), paidAt: null })),
    );
    snapshots.push(orderSnapshot(29, { createdAt: ist('2026-10-19', '10:00'), total: 999 }));
    await sendOrders(pos, snapshots);
    const base = `/api/owner/stores/${pos.storeId}/orders`;

    const first = await agent.get(base).expect(200);
    expect(first.body).toMatchObject({
      from: '2026-10-20',
      to: '2026-10-20',
      page: 1,
      per_page: 25,
      total: 28,
      totals: { gross_sales: '2700.00', cancelled_count: 1 },
      types: ['dine_in', 'takeaway'],
    });
    expect(first.body.data).toHaveLength(25);
    expect(first.body.data[0]).toMatchObject({ order_number: 'A-28', status: 'cancelled' });
    expect(first.body.data[1]).toMatchObject({
      order_number: 'A-27',
      items_count: 1,
      total: '100.00',
      paid: '100.00',
      payment_status: 'paid',
      table: 'T3',
    });
    const second = await agent.get(`${base}?page=2`).expect(200);
    expect(second.body.data.map((o: { order_number: string }) => o.order_number)).toEqual([
      'A-3',
      'A-2',
      'A-1',
    ]);

    const takeaway = await agent.get(`${base}?type=takeaway`).expect(200);
    expect(takeaway.body.total).toBe(3);
    const cancelledOnly = await agent.get(`${base}?status=cancelled`).expect(200);
    expect(cancelledOnly.body.data.map((o: { order_number: string }) => o.order_number)).toEqual([
      'A-28',
    ]);
    const search = await agent.get(`${base}?q=a-2`).expect(200);
    expect(search.body.total).toBe(10); // A-2 and A-20 to A-28
    const range = await agent.get(`${base}?from=2026-10-19&to=2026-10-20`).expect(200);
    expect(range.body.total).toBe(29);

    await agent.get(`${base}?from=2026-10-21&to=2026-10-20`).expect(400, /invalid_range/);
    await agent.get(`${base}?from=2026-01-01&to=2026-10-20`).expect(400, /range_too_long/);
  });

  it('shows one order with voided items and split bills, and only to its store', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    const base = orderSnapshot(5, { createdAt: ist('2026-10-20', '11:00'), total: 315 });
    const half = (n: number, label: string) => ({
      ...base.bill,
      id: 50 + n,
      bill_number: `B-5-${n}`,
      total: 157.5,
      paid_amount: 157.5,
      split_label: label,
    });
    await sendOrders(pos, [
      {
        ...base,
        items: [
          ...base.items,
          {
            ...base.items[0],
            id: 501,
            product_name: 'Muffin',
            total: 90,
            voided_at: sqliteTime(FIXED_NOW),
          },
        ],
        bill: half(1, 'Split 1/2'),
        bills: [half(1, 'Split 1/2'), half(2, 'Split 2/2')],
      },
    ]);
    const [row] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.storeId, pos.storeId), eq(schema.orders.posOrderId, 5)));

    const res = await agent.get(`/api/owner/stores/${pos.storeId}/orders/${row.id}`).expect(200);
    expect(res.body.order).toMatchObject({ order_number: 'A-5', total: '315.00', table: 'T3' });
    expect(res.body.items).toMatchObject([
      { name: 'Cappuccino', voided: false },
      { name: 'Muffin', voided: true },
    ]);
    expect(res.body.bills).toMatchObject([
      { bill_number: 'B-5-1', split_label: 'Split 1/2', total: '157.50' },
      { bill_number: 'B-5-2', split_label: 'Split 2/2', paid: '157.50' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('UPI');

    const other = await registerPos(app);
    const stranger = await ownerOf(other.storeId);
    await stranger.agent.get(`/api/owner/stores/${other.storeId}/orders/${row.id}`).expect(404);
  });
});
