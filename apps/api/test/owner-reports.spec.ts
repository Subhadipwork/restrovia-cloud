/** Owner portal reports: sales by period, items, hours, the payments split and CSV files. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
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
/** 14:00 in India on Tuesday 20 October 2026. */
const FIXED_NOW = new Date('2026-10-20T08:30:00Z');
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);

type Pos = PosIdentity & { storeId: string };
type Snapshot = ReturnType<typeof orderSnapshot>;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  // Listening once lets several requests run at the same time (the payments tests need that).
  await app.listen(0);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

afterEach(() => {
  vi.useRealTimers();
});

const fixNow = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
};

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

const item = (
  id: number,
  name: string,
  quantity: number,
  total: number,
  voidedAt: Date | null = null,
) => ({
  id,
  product_name: name,
  product_sku: null,
  variant_id: null,
  quantity,
  unit_price: total / quantity,
  subtotal: total,
  tax_amount: 0,
  discount_amount: 0,
  total,
  status: 'served',
  voided_at: voidedAt ? sqliteTime(voidedAt) : null,
});

const REPORTS = ['sales', 'items', 'hours', 'payments'];

describe('access', () => {
  it('hides another store’s reports and lets a manager read their own', async () => {
    const mine = await registerPos(app);
    const other = await registerPos(app);
    const { agent } = await ownerOf(mine.storeId, 'manager');
    await ownerOf(other.storeId);

    for (const report of REPORTS) {
      await agent.get(`/api/owner/stores/${other.storeId}/reports/${report}`).expect(404);
      await agent.get(`/api/owner/stores/${other.storeId}/reports/${report}.csv`).expect(404);
      await agent.get(`/api/owner/stores/${mine.storeId}/reports/${report}`).expect(200);
    }
    await request(app.getHttpServer())
      .get(`/api/owner/stores/${mine.storeId}/reports/sales`)
      .expect(401);
  });
});

describe('sales report', () => {
  beforeEach(fixNow);

  async function storeWithSales() {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '12:00'), total: 315 }),
      orderSnapshot(2, { createdAt: ist('2026-10-20', '13:00'), total: 500, type: 'takeaway' }),
      orderSnapshot(3, { createdAt: ist('2026-10-19', '12:00'), total: 100 }),
      orderSnapshot(4, { createdAt: ist('2026-10-15', '10:00'), total: 250 }),
      orderSnapshot(5, { createdAt: ist('2026-10-12', '10:00'), total: 200 }),
      // The day before the range: only in the period it is compared with.
      orderSnapshot(6, { createdAt: ist('2026-10-11', '10:00'), total: 400 }),
      cancelled(orderSnapshot(7, { createdAt: ist('2026-10-20', '11:00'), paidAt: null })),
    ]);
    return { pos, agent, base: `/api/owner/stores/${pos.storeId}/reports/sales` };
  }

  it('adds up each day, the range and the period before', async () => {
    const { pos, agent, base } = await storeWithSales();
    const res = await agent.get(`${base}?from=2026-10-12&to=2026-10-20`).expect(200);

    expect(res.body).toMatchObject({ from: '2026-10-12', to: '2026-10-20', group: 'day' });
    expect(res.body.totals).toEqual({
      gross_sales: '1365.00',
      net_sales: '1290.00',
      tax_total: '75.00',
      discount_total: '0.00',
      avg_bill: '273.00',
      orders_count: 5,
      bills_count: 5,
      cancelled_count: 1,
    });
    expect(res.body.previous).toMatchObject({
      from: '2026-10-03',
      to: '2026-10-11',
      gross_sales: '400.00',
      bills_count: 1,
    });
    expect(res.body.by_type).toEqual({
      dine_in: { sales: '865.00', count: 4 },
      takeaway: { sales: '500.00', count: 1 },
    });
    expect(res.body.periods).toHaveLength(9);
    expect(res.body.periods[0]).toMatchObject({
      start: '2026-10-12',
      end: '2026-10-12',
      partial: false,
      gross_sales: '200.00',
    });
    // A day with no sales is a row of zeros, not a gap.
    expect(res.body.periods[1]).toMatchObject({ start: '2026-10-13', gross_sales: '0.00' });
    expect(res.body.periods[8]).toMatchObject({ gross_sales: '815.00', cancelled_count: 1 });

    const [stored] = await db
      .select({ gross: sql<string>`sum(gross_sales)::numeric(14, 2)::text` })
      .from(schema.dailyStoreStats)
      .where(
        and(
          eq(schema.dailyStoreStats.storeId, pos.storeId),
          gte(schema.dailyStoreStats.businessDate, '2026-10-12'),
          lte(schema.dailyStoreStats.businessDate, '2026-10-20'),
        ),
      );
    expect(res.body.totals.gross_sales).toBe(stored.gross);

    // With no dates, the report is today.
    const today = await agent.get(base).expect(200);
    expect(today.body).toMatchObject({ from: '2026-10-20', to: '2026-10-20' });
    expect(today.body.totals.gross_sales).toBe('815.00');
  });

  it('groups by Monday-to-Sunday week and by month, marking cut periods', async () => {
    const { agent, base } = await storeWithSales();

    const weeks = await agent.get(`${base}?from=2026-10-12&to=2026-10-20&group=week`).expect(200);
    expect(weeks.body.periods).toEqual([
      expect.objectContaining({
        start: '2026-10-12',
        end: '2026-10-18',
        partial: false,
        gross_sales: '450.00',
        avg_bill: '225.00',
      }),
      expect.objectContaining({
        start: '2026-10-19',
        end: '2026-10-20',
        partial: true,
        gross_sales: '915.00',
      }),
    ]);

    const cut = await agent.get(`${base}?from=2026-10-14&to=2026-10-20&group=week`).expect(200);
    expect(cut.body.periods[0]).toMatchObject({
      start: '2026-10-14',
      end: '2026-10-18',
      partial: true,
      gross_sales: '250.00',
    });

    const months = await agent.get(`${base}?from=2026-09-01&to=2026-10-20&group=month`).expect(200);
    expect(months.body.periods).toEqual([
      expect.objectContaining({ start: '2026-09-01', end: '2026-09-30', partial: false }),
      expect.objectContaining({
        start: '2026-10-01',
        end: '2026-10-20',
        partial: true,
        gross_sales: '1765.00',
      }),
    ]);
  });

  it('refuses ranges that are backwards, in the future, too long or not dates', async () => {
    const { agent, base } = await storeWithSales();
    await agent.get(`${base}?from=2026-10-20&to=2026-10-19`).expect(400, /invalid_range/);
    await agent.get(`${base}?from=2026-10-20&to=2026-10-21`).expect(400, /future_date/);
    await agent.get(`${base}?from=2026-07-01&to=2026-10-20`).expect(400, /range_too_long/);
    await agent.get(`${base}?from=2026-07-01&to=2026-10-20&group=week`).expect(200);
    await agent.get(`${base}?from=2024-10-01&to=2026-10-20&group=month`).expect(400);
    await agent.get(`${base}?from=2026-13-40`).expect(400, /invalid_request/);
    await agent.get(`${base}?group=year`).expect(400, /invalid_request/);
  });

  it('downloads the same numbers as a CSV file', async () => {
    const { pos, agent, base } = await storeWithSales();
    const res = await agent.get(`${base}.csv?from=2026-10-19&to=2026-10-20`).expect(200);
    const code = pos.storeId.replace(/-/g, '').slice(0, 8).toUpperCase();

    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${code}-sales-2026-10-19-to-2026-10-20.csv"`,
    );
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text.slice(1).split('\r\n')).toEqual([
      'Café,Blue Door Café',
      'Report,Sales by day',
      'From,2026-10-19',
      'To,2026-10-20',
      'Currency,INR',
      '',
      'From,To,Orders,Cancelled orders,Paid bills,Sales,Net of tax,Tax,Discount,Average bill',
      '2026-10-19,2026-10-19,1,0,1,100.00,85.00,15.00,0.00,100.00',
      '2026-10-20,2026-10-20,2,1,2,815.00,785.00,30.00,0.00,407.50',
      'Total,,3,1,3,915.00,870.00,45.00,0.00,305.00',
      '',
    ]);
  });
});

describe('items report', () => {
  beforeEach(fixNow);

  async function storeWithItems() {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      {
        ...orderSnapshot(1, { createdAt: ist('2026-10-20', '12:00') }),
        items: [
          item(101, 'Cappuccino', 2, 300),
          item(102, 'Masala Chai', 1, 80),
          item(103, 'Brownie', 1, 150, FIXED_NOW),
        ],
      },
      {
        ...orderSnapshot(2, { createdAt: ist('2026-10-19', '12:00') }),
        items: [item(201, 'Cappuccino', 1, 150), item(202, '=Latte, "large"', 4, 600)],
      },
      {
        ...cancelled(orderSnapshot(3, { createdAt: ist('2026-10-20', '13:00'), paidAt: null })),
        items: [item(301, 'Cappuccino', 5, 750)],
      },
      {
        ...orderSnapshot(4, { createdAt: ist('2026-10-18', '12:00') }),
        items: [item(401, 'Sandwich', 1, 220)],
      },
    ]);
    return { agent, base: `/api/owner/stores/${pos.storeId}/reports/items` };
  }

  it('ranks items sold, leaving out voided items and cancelled orders', async () => {
    const { agent, base } = await storeWithItems();
    const range = 'from=2026-10-19&to=2026-10-20';

    const res = await agent.get(`${base}?${range}`).expect(200);
    expect(res.body).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-20',
      sort: 'revenue',
      totals: { revenue: '1130.00', quantity: '8.000', products: 3 },
    });
    expect(res.body.items).toEqual([
      { name: '=Latte, "large"', quantity: '4.000', revenue: '600.00', share: 53.1 },
      { name: 'Cappuccino', quantity: '3.000', revenue: '450.00', share: 39.8 },
      { name: 'Masala Chai', quantity: '1.000', revenue: '80.00', share: 7.1 },
    ]);

    const byQuantity = await agent.get(`${base}?${range}&sort=quantity`).expect(200);
    expect(byQuantity.body.items.map((i: { name: string }) => i.name)).toEqual([
      '=Latte, "large"',
      'Cappuccino',
      'Masala Chai',
    ]);

    // A search narrows the list; totals and shares still cover every item.
    const search = await agent.get(`${base}?${range}&q=capp`).expect(200);
    expect(search.body.totals.revenue).toBe('1130.00');
    expect(search.body.items).toEqual([
      { name: 'Cappuccino', quantity: '3.000', revenue: '450.00', share: 39.8 },
    ]);

    await agent.get(`${base}?from=2026-07-01&to=2026-10-20`).expect(400, /range_too_long/);
  });

  it('escapes item names in the CSV file', async () => {
    const { agent, base } = await storeWithItems();
    const res = await agent.get(`${base}.csv?from=2026-10-19&to=2026-10-20`).expect(200);
    const lines = res.text.slice(1).split('\r\n');
    expect(lines.slice(6)).toEqual([
      'Item,Quantity,Sales,Share of sales %',
      // Quoted for its comma and quotes, and prefixed so Excel doesn't run it as a formula.
      '"\'=Latte, ""large""",4,600.00,53.1',
      'Cappuccino,3,450.00,39.8',
      'Masala Chai,1,80.00,7.1',
      'All items,8,1130.00,',
      '',
    ]);
  });
});

describe('hours report', () => {
  beforeEach(fixNow);

  it('adds up each clock hour and averages over days with sales', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '12:10'), total: 315 }),
      orderSnapshot(2, { createdAt: ist('2026-10-20', '13:00'), total: 500 }),
      orderSnapshot(3, { createdAt: ist('2026-10-19', '12:40'), total: 100 }),
    ]);
    const base = `/api/owner/stores/${pos.storeId}/reports/hours`;

    const res = await agent.get(`${base}?from=2026-10-17&to=2026-10-20`).expect(200);
    expect(res.body).toMatchObject({
      from: '2026-10-17',
      to: '2026-10-20',
      total_sales: '915.00',
      days_with_sales: 2,
      busiest_hour: 13,
    });
    expect(res.body.hours).toHaveLength(24);
    expect(res.body.hours[12]).toEqual({ hour: 12, sales: '415.00', average: '207.50' });
    expect(res.body.hours[13]).toEqual({ hour: 13, sales: '500.00', average: '250.00' });
    expect(res.body.hours[9]).toEqual({ hour: 9, sales: '0.00', average: '0.00' });

    const empty = await agent.get(`${base}?from=2026-10-01&to=2026-10-05`).expect(200);
    expect(empty.body).toMatchObject({
      total_sales: '0.00',
      days_with_sales: 0,
      busiest_hour: null,
    });

    const file = await agent.get(`${base}.csv?from=2026-10-17&to=2026-10-20`).expect(200);
    const lines = file.text.slice(1).split('\r\n');
    expect(lines[6]).toBe('Hour,Sales,Average per day with sales');
    expect(lines[7 + 12]).toBe('12:00,415.00,207.50');
    expect(lines[7 + 24]).toBe('Total,915.00,');
  });

  it('starts the chart at the store’s business day start', async () => {
    const pos = await registerPos(app);
    await db
      .update(schema.stores)
      .set({ businessDayStart: '04:00' })
      .where(eq(schema.stores.id, pos.storeId));
    const { agent } = await ownerOf(pos.storeId);
    await sendOrders(pos, [
      orderSnapshot(1, { createdAt: ist('2026-10-20', '01:00'), total: 120 }),
    ]);

    const res = await agent
      .get(`/api/owner/stores/${pos.storeId}/reports/hours?from=2026-10-19&to=2026-10-19`)
      .expect(200);
    expect(res.body.hours[0].hour).toBe(4);
    expect(res.body.hours[21]).toEqual({ hour: 1, sales: '120.00', average: '120.00' });
    expect(res.body.busiest_hour).toBe(1);
  });
});

describe('payments report', () => {
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  async function seen(storeId: string, minutesAgo: number) {
    await db
      .update(schema.posDevices)
      .set({ lastHeartbeatAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(schema.posDevices.storeId, storeId));
  }

  /** Answers the next report.payments command the way the POS does. */
  async function answerAsPos(pos: Pos, result: unknown) {
    for (let i = 0; i < 60; i++) {
      const res = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
      const command = res.body.commands[0];
      if (command) {
        await posCall(app, pos, 'POST', `/api/pos/commands/${command.id}/result`, {
          version: 1,
          correlation_id: command.id,
          ok: true,
          result,
          completed_at: new Date().toISOString(),
        }).expect(200);
        return command as { id: string; type: string; payload: unknown };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('No report.payments command reached the POS');
  }

  const commandsFor = (storeId: string) =>
    db.select().from(schema.commands).where(eq(schema.commands.storeId, storeId));

  it('asks the POS for the split and shares one answer for a few minutes', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await seen(pos.storeId, 1);
    const base = `/api/owner/stores/${pos.storeId}/reports/payments`;

    const pending = agent.get(base).then((r) => r);
    const command = await answerAsPos(pos, {
      total: 815,
      breakdown: [
        { method: 'Cash', amount: 314.5, count: 2, percent: 38.6 },
        { method: 'UPI', amount: 500.5, count: 3, percent: 61.4 },
      ],
    });
    expect(command).toMatchObject({
      type: 'report.payments',
      payload: { from: today(), to: today() },
    });

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from: today(),
      to: today(),
      available: true,
      reason: null,
      total: '815.00',
      methods: [
        { method: 'UPI', amount: '500.50', count: 3, percent: 61.4 },
        { method: 'Cash', amount: '314.50', count: 2, percent: 38.6 },
      ],
    });
    expect(res.body.as_of).toEqual(expect.any(String));

    // Only a count stays in the stored command.
    const [stored] = await commandsFor(pos.storeId);
    expect(stored.result).toEqual({ methods: 2 });

    // The next view and the CSV file reuse the answer.
    await agent.get(base).expect(200);
    const file = await agent.get(`${base}.csv`).expect(200);
    expect(file.text.slice(1).split('\r\n').slice(6)).toEqual([
      'Method,Payments,Amount,Share %',
      'UPI,3,500.50,61.4',
      'Cash,2,314.50,38.6',
      'Total,,815.00,',
      '',
    ]);
    expect(await commandsFor(pos.storeId)).toHaveLength(1);
  });

  it('says the POS is offline without queueing a command', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await seen(pos.storeId, 30);
    const base = `/api/owner/stores/${pos.storeId}/reports/payments`;

    const res = await agent.get(base).expect(200);
    expect(res.body).toMatchObject({
      available: false,
      reason: 'offline',
      total: '0.00',
      methods: [],
    });
    await agent.get(`${base}.csv`).expect(409, /payments_unavailable/);
    expect(await commandsFor(pos.storeId)).toHaveLength(0);
  });

  it('gives up when the POS doesn’t answer in time', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await seen(pos.storeId, 1);
    const res = await agent.get(`/api/owner/stores/${pos.storeId}/reports/payments`).expect(200);
    expect(res.body).toMatchObject({ available: false, reason: 'no_answer' });
  });

  it('stops asking once the licence has ended, while other reports stay', async () => {
    const pos = await registerPos(app);
    const { agent } = await ownerOf(pos.storeId);
    await seen(pos.storeId, 1);
    await db
      .update(schema.stores)
      .set({ status: 'suspended', updatedAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(schema.stores.id, pos.storeId));

    const res = await agent.get(`/api/owner/stores/${pos.storeId}/reports/payments`).expect(200);
    expect(res.body).toMatchObject({ available: false, reason: 'licence_inactive' });
    expect(await commandsFor(pos.storeId)).toHaveLength(0);
    await agent.get(`/api/owner/stores/${pos.storeId}/reports/sales`).expect(200);
  });
});
