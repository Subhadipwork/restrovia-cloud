/** The POS-facing API, called the way the Restrovia POS calls it. Needs TEST_DATABASE_URL. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { CommandsService } from '../src/commands/commands.service.js';
import * as schema from '../src/db/schema/index.js';
import {
  createTestApp,
  posCall,
  registerBody,
  registerPos,
  resetDatabase,
  signedHeaders,
  sqliteTime,
  testDatabaseUrl,
  type PosIdentity,
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  app = await createTestApp(url);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

/** An order snapshot shaped like decorateOrders() output in the POS. */
function orderSnapshot(
  id: number,
  opts: {
    updatedAt?: Date;
    createdAt?: Date;
    paidAt?: Date | null;
    total?: number;
    type?: string;
  } = {},
) {
  const created = opts.createdAt ?? new Date();
  const total = opts.total ?? 315;
  const paidAt = opts.paidAt === undefined ? created : opts.paidAt;
  const bill = {
    id: id * 10,
    bill_number: `B-${id}`,
    order_id: id,
    customer_id: 77,
    subtotal: 300,
    tax_amount: 15,
    discount_amount: 0,
    total,
    paid_amount: paidAt ? total : 0,
    balance: paidAt ? 0 : total,
    payment_status: paidAt ? 'paid' : 'unpaid',
    payment_details: [{ method: 'UPI', amount: total }],
    paid_at: paidAt ? sqliteTime(paidAt) : null,
    split_label: null,
  };
  return {
    id,
    order_number: `A-${id}`,
    table_id: 3,
    customer_id: 77,
    user_id: 1,
    type: opts.type ?? 'dine_in',
    status: paidAt ? 'completed' : 'served',
    subtotal: 300,
    tax_amount: 15,
    discount_amount: 0,
    packaging_charge: 0,
    delivery_charge: 0,
    service_charge: 0,
    round_off: 0,
    total,
    guest_count: 2,
    online_platform: null,
    external_order_id: null,
    created_at: sqliteTime(created),
    updated_at: sqliteTime(opts.updatedAt ?? created),
    completed_at: paidAt ? sqliteTime(paidAt) : null,
    cancelled_at: null,
    // Fields the POS removes; sent here to prove the cloud drops them too.
    customer: { name: 'Should Not Store', phone: '+910000000000' },
    delivery_address: 'Secret street',
    items: [
      {
        id: id * 100,
        order_id: id,
        product_name: 'Cappuccino',
        product_sku: 'CAP',
        variant_id: null,
        quantity: 2,
        unit_price: 150,
        subtotal: 300,
        tax_amount: 15,
        discount_amount: 0,
        total,
        status: 'served',
        voided_at: null,
        special_instructions: 'extra hot',
      },
    ],
    table: { id: 3, number: 'T3', name: 'T3' },
    bill,
    bills: [bill],
  };
}

const orderEvent = (snapshot: ReturnType<typeof orderSnapshot>, type = 'order.created') => ({
  id: randomUUID(),
  type,
  entity_type: 'order',
  entity_id: String(snapshot.id),
  payload: snapshot,
});

const eventsBody = (pos: PosIdentity, events: unknown[]) => ({
  pos_hash: pos.posHash,
  events,
  sent_at: new Date().toISOString(),
});

const stats = (storeId: string, day: string) =>
  db.query.dailyStoreStats.findFirst({
    where: and(
      eq(schema.dailyStoreStats.storeId, storeId),
      eq(schema.dailyStoreStats.businessDate, day),
    ),
  });

describe('POST /api/pos/register', () => {
  it('creates a store, device and 30-day trial and returns the ids and key', async () => {
    const pos = await registerPos(app);
    expect(pos.apiKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const store = await db.query.stores.findFirst({ where: eq(schema.stores.id, pos.storeId) });
    expect(store).toMatchObject({
      name: 'Blue Door Café',
      country: 'IN',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    });
    const sub = await db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.storeId, pos.storeId),
    });
    expect(sub?.status).toBe('trial');
    const days = (sub!.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
  });

  it('gives the same install its existing ids back', async () => {
    const body = registerBody();
    const first = await request(app.getHttpServer())
      .post('/api/pos/register')
      .send(body)
      .expect(200);
    const again = await request(app.getHttpServer())
      .post('/api/pos/register')
      .send(body)
      .expect(200);
    expect(again.body).toEqual(first.body);
  });

  it('refuses a known install id with a different device secret', async () => {
    const body = registerBody();
    await request(app.getHttpServer()).post('/api/pos/register').send(body).expect(200);
    await request(app.getHttpServer())
      .post('/api/pos/register')
      .send({ ...body, device_secret_hash: 'f'.repeat(64) })
      .expect(409);
  });

  it('falls back to India time for an unknown timezone and rejects a body without pos_hash', async () => {
    const body = registerBody();
    body.business.timezone = 'Mars/Olympus';
    const res = await request(app.getHttpServer()).post('/api/pos/register').send(body).expect(200);
    const store = await db.query.stores.findFirst({
      where: eq(schema.stores.id, res.body.store_id),
    });
    expect(store?.timezone).toBe('Asia/Kolkata');
    await request(app.getHttpServer()).post('/api/pos/register').send({ business: {} }).expect(400);
  });
});

describe('request signatures', () => {
  let pos: PosIdentity;
  beforeAll(async () => {
    pos = await registerPos(app);
  });

  it('accepts a correctly signed request', async () => {
    const res = await posCall(app, pos, 'POST', '/api/pos/connection-test', {}).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects missing headers, a wrong key and a wrong install id', async () => {
    await request(app.getHttpServer()).post('/api/pos/connection-test').send({}).expect(401);
    await posCall(
      app,
      { ...pos, apiKey: 'not-the-key' },
      'POST',
      '/api/pos/connection-test',
      {},
    ).expect(401);
    await posCall(app, { ...pos, posHash: 'other' }, 'POST', '/api/pos/connection-test', {}).expect(
      401,
    );
  });

  it('rejects a body changed after signing', async () => {
    const body = JSON.stringify({ a: 1 });
    const headers = signedHeaders(pos, 'POST', '/api/pos/connection-test', body);
    const req = request(app.getHttpServer()).post('/api/pos/connection-test');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    await req.send(JSON.stringify({ a: 2 })).expect(401);
  });

  it('rejects a signature made for another path', async () => {
    const headers = signedHeaders(pos, 'POST', '/api/pos/heartbeat', '{}');
    const req = request(app.getHttpServer()).post('/api/pos/connection-test');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    await req.send('{}').expect(401);
  });

  it('rejects an old timestamp', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const headers = signedHeaders(pos, 'POST', '/api/pos/connection-test', '{}', {
      timestamp: old,
    });
    const req = request(app.getHttpServer()).post('/api/pos/connection-test');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    await req.send('{}').expect(401);
  });

  it('rejects a replayed request', async () => {
    const headers = signedHeaders(pos, 'POST', '/api/pos/connection-test', '{}');
    const send = () => {
      const req = request(app.getHttpServer()).post('/api/pos/connection-test');
      for (const [k, v] of Object.entries(headers)) req.set(k, v);
      return req.send('{}');
    };
    await send().expect(200);
    const replay = await send().expect(401);
    expect(replay.body.reason).toBe('replayed_nonce');
  });

  it('answers 410 for a revoked device', async () => {
    const other = await registerPos(app);
    await db
      .update(schema.posDevices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.posDevices.id, other.posId));
    await posCall(app, other, 'POST', '/api/pos/connection-test', {}).expect(410);
  });
});

describe('POST /api/pos/heartbeat', () => {
  it('records the device state and turns cloud features on during the trial', async () => {
    const pos = await registerPos(app);
    const res = await posCall(app, pos, 'POST', '/api/pos/heartbeat', {
      pos_hash: pos.posHash,
      pos_id: pos.posId,
      app_version: '3.13.15',
      device_name: 'COUNTER-1',
      active_orders: 4,
      today_sales: 1234.5,
      today_bills: 9,
      sent_at: new Date().toISOString(),
    }).expect(200);
    expect(res.body.features).toEqual({
      cloud_sync_enabled: true,
      cloud_orders_enabled: true,
      cloud_reports_enabled: true,
    });
    const device = await db.query.posDevices.findFirst({
      where: eq(schema.posDevices.id, pos.posId),
    });
    expect(device).toMatchObject({
      appVersion: '3.13.15',
      deviceName: 'COUNTER-1',
      activeOrders: 4,
      todayBills: 9,
      todaySales: '1234.50',
    });
    expect(device?.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('keeps sync on but stops orders and reports when the trial has ended', async () => {
    const pos = await registerPos(app);
    await db
      .update(schema.subscriptions)
      .set({ trialEndsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.subscriptions.storeId, pos.storeId));
    const res = await posCall(app, pos, 'POST', '/api/pos/heartbeat', {
      pos_hash: pos.posHash,
      sent_at: new Date().toISOString(),
    }).expect(200);
    expect(res.body.features).toEqual({
      cloud_sync_enabled: true,
      cloud_orders_enabled: false,
      cloud_reports_enabled: false,
    });
  });
});

describe('POST /api/pos/events', () => {
  let pos: PosIdentity & { storeId: string };
  beforeAll(async () => {
    pos = await registerPos(app);
  });

  it('stores the order, its items and bills, and builds the daily totals', async () => {
    // 2026-11-03 19:30 UTC is 01:00 on 4 Nov in India: it counts on 4 Nov.
    const at = new Date('2026-11-03T19:30:00Z');
    const res = await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [orderEvent(orderSnapshot(1, { createdAt: at }))]),
    ).expect(200);
    expect(res.body).toMatchObject({ ok: true, accepted: 1, duplicates: 0, stale: 0, rejected: 0 });

    const order = await db.query.orders.findFirst({
      where: and(eq(schema.orders.storeId, pos.storeId), eq(schema.orders.posOrderId, 1)),
    });
    expect(order).toMatchObject({
      orderNumber: 'A-1',
      type: 'dine_in',
      total: '315.00',
      paidAmount: '315.00',
      paymentStatus: 'paid',
      tableName: 'T3',
      businessDate: '2026-11-04',
    });
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order!.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productName: 'Cappuccino',
      quantity: '2.000',
      total: '315.00',
    });

    const day = await stats(pos.storeId, '2026-11-04');
    expect(day).toMatchObject({
      billsCount: 1,
      ordersCount: 1,
      grossSales: '315.00',
      taxTotal: '15.00',
      netSales: '300.00',
      avgBill: '315.00',
    });
    expect(day?.byType).toEqual({ dine_in: { sales: '315.00', count: 1 } });
    expect(day?.byHour[1]).toBe('315.00');
  });

  it('never stores customer details, addresses, notes or payment details', async () => {
    const order = await db.query.orders.findFirst({
      where: and(eq(schema.orders.storeId, pos.storeId), eq(schema.orders.posOrderId, 1)),
    });
    const text = JSON.stringify(order?.snapshot);
    for (const leaked of ['Should Not Store', 'Secret street', 'extra hot', 'UPI', 'customer_id']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('ignores a resent batch', async () => {
    const event = orderEvent(orderSnapshot(2, { createdAt: new Date('2026-11-04T06:00:00Z') }));
    await posCall(app, pos, 'POST', '/api/pos/events', eventsBody(pos, [event])).expect(200);
    const again = await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [event]),
    ).expect(200);
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 1 });
    expect((await stats(pos.storeId, '2026-11-04'))?.billsCount).toBe(2);
  });

  it('applies a newer update and ignores an older one that arrives late', async () => {
    const created = new Date('2026-11-04T07:00:00Z');
    const newer = orderSnapshot(3, {
      createdAt: created,
      updatedAt: new Date('2026-11-04T07:10:00Z'),
      total: 500,
    });
    const older = orderSnapshot(3, {
      createdAt: created,
      updatedAt: new Date('2026-11-04T07:05:00Z'),
      total: 400,
    });
    await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [orderEvent(newer, 'order.updated')]),
    ).expect(200);
    const late = await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [orderEvent(older, 'order.updated')]),
    ).expect(200);
    expect(late.body.stale).toBe(1);
    const order = await db.query.orders.findFirst({
      where: and(eq(schema.orders.storeId, pos.storeId), eq(schema.orders.posOrderId, 3)),
    });
    expect(order?.total).toBe('500.00');
    expect((await stats(pos.storeId, '2026-11-04'))?.grossSales).toBe('1130.00');
  });

  it('counts an unpaid order but not its sales until the bill is paid', async () => {
    const created = new Date('2026-11-04T08:00:00Z');
    await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [orderEvent(orderSnapshot(4, { createdAt: created, paidAt: null }))]),
    ).expect(200);
    let day = await stats(pos.storeId, '2026-11-04');
    expect(day).toMatchObject({ ordersCount: 4, billsCount: 3, grossSales: '1130.00' });
    const paid = orderSnapshot(4, {
      createdAt: created,
      updatedAt: new Date('2026-11-04T08:30:00Z'),
      paidAt: new Date('2026-11-04T08:30:00Z'),
    });
    await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [orderEvent(paid, 'order.updated')]),
    ).expect(200);
    day = await stats(pos.storeId, '2026-11-04');
    expect(day).toMatchObject({ ordersCount: 4, billsCount: 4, grossSales: '1445.00' });
  });

  it('keeps going when one event is unusable', async () => {
    const res = await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [
        {
          id: randomUUID(),
          type: 'order.created',
          entity_type: 'order',
          entity_id: 'x',
          payload: { nonsense: true },
        },
        {
          id: randomUUID(),
          type: 'order.status',
          entity_type: 'order',
          entity_id: 'of-1',
          payload: { status: 'accepted' },
        },
        orderEvent(orderSnapshot(5, { createdAt: new Date('2026-11-05T06:00:00Z') })),
      ]),
    ).expect(200);
    expect(res.body).toMatchObject({ accepted: 3, rejected: 1 });
    expect((await stats(pos.storeId, '2026-11-05'))?.billsCount).toBe(1);
  });

  it('accepts a full batch of 50 large snapshots', async () => {
    const events = Array.from({ length: 50 }, (_, i) => {
      const snap = orderSnapshot(1000 + i, { createdAt: new Date('2026-11-06T06:00:00Z') });
      snap.items = Array.from({ length: 80 }, (_, j) => ({
        ...snap.items[0],
        id: (1000 + i) * 100 + j,
      }));
      return orderEvent(snap);
    });
    const body = eventsBody(pos, events);
    expect(JSON.stringify(body).length).toBeGreaterThan(1_000_000);
    const res = await posCall(app, pos, 'POST', '/api/pos/events', body).expect(200);
    expect(res.body.accepted).toBe(50);
  });

  it('rejects a body whose pos_hash is not the signed one', async () => {
    await posCall(app, pos, 'POST', '/api/pos/events', {
      ...eventsBody(pos, []),
      pos_hash: 'other',
    }).expect(400);
  });
});

describe('commands', () => {
  it('hands a command out once, takes the result and lets the portal wait for it', async () => {
    const pos = await registerPos(app);
    const commandsService = app.get(CommandsService);
    const command = await commandsService.create(pos.storeId, 'report.sales', {
      from: '2026-11-04',
    });

    const first = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
    expect(first.body.commands).toEqual([
      {
        id: command.id,
        type: 'report.sales',
        payload: { from: '2026-11-04' },
        correlation_id: command.id,
      },
    ]);
    const second = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
    expect(second.body.commands).toEqual([]);

    const waiting = commandsService.waitForResult(command.id, 5_000, 50);
    await posCall(app, pos, 'POST', `/api/pos/commands/${command.id}/result`, {
      version: 1,
      correlation_id: command.id,
      ok: true,
      result: { totals: { gross_sales: 1445 } },
      completed_at: new Date().toISOString(),
    }).expect(200);
    const done = await waiting;
    expect(done).toMatchObject({ status: 'done', result: { totals: { gross_sales: 1445 } } });
  });

  it('does not hand out expired commands and refuses results for another device', async () => {
    const pos = await registerPos(app);
    const other = await registerPos(app);
    const commandsService = app.get(CommandsService);
    const command = await commandsService.create(pos.storeId, 'health.get');
    await posCall(app, other, 'POST', `/api/pos/commands/${command.id}/result`, {
      version: 1,
      correlation_id: command.id,
      ok: true,
      completed_at: new Date().toISOString(),
    }).expect(404);
    await posCall(app, pos, 'POST', '/api/pos/commands/not-a-uuid/result', {
      version: 1,
      correlation_id: 'x',
      ok: true,
      completed_at: new Date().toISOString(),
    }).expect(404);

    await db
      .update(schema.commands)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.commands.id, command.id));
    const res = await posCall(app, pos, 'GET', '/api/pos/commands').expect(200);
    expect(res.body.commands).toEqual([]);
  });
});

describe('pairing, devices and support', () => {
  it('creates a 6-digit pairing code valid for 15 minutes', async () => {
    const pos = await registerPos(app);
    const res = await posCall(app, pos, 'POST', '/api/pos/pairing-code', {
      revoke_devices: false,
    }).expect(200);
    expect(res.body.code).toMatch(/^\d{6}$/);
    const minutes = (Date.parse(res.body.expires_at) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('lists linked owners’ sign-ins, and revoking unlinks them', async () => {
    const pos = await registerPos(app);
    const [owner] = await db
      .insert(schema.owners)
      .values({ phoneE164: `+91${Date.now()}`.slice(0, 13) })
      .returning();
    await db
      .insert(schema.storeMembers)
      .values({ storeId: pos.storeId, ownerId: owner.id, role: 'owner' });
    await db.insert(schema.ownerSessions).values({
      ownerId: owner.id,
      tokenHash: Buffer.from(randomUUID()),
      userAgent: 'Mobile Safari',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const list = await posCall(app, pos, 'GET', '/api/pos/devices').expect(200);
    expect(list.body.devices).toHaveLength(1);
    expect(Object.keys(list.body.devices[0]).sort()).toEqual([
      'app_version',
      'country',
      'first_seen_at',
      'id',
      'last_seen_at',
      'platform',
      'user_agent',
    ]);

    await posCall(app, pos, 'POST', '/api/pos/pairing-code', { revoke_devices: true }).expect(200);
    const after = await posCall(app, pos, 'GET', '/api/pos/devices').expect(200);
    expect(after.body.devices).toEqual([]);
  });

  it('stores a support ticket and returns the same code when it is resent', async () => {
    const pos = await registerPos(app);
    const ticket = {
      client_ticket_id: randomUUID(),
      subject: 'Printer not printing',
      message: 'KOT stuck',
      severity: 'high',
      event_code: 'support.printer',
    };
    const first = await posCall(app, pos, 'POST', '/api/pos/support-ticket', ticket).expect(200);
    expect(first.body.support_code).toMatch(/^RV-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const again = await posCall(app, pos, 'POST', '/api/pos/support-ticket', ticket).expect(200);
    expect(again.body.support_code).toBe(first.body.support_code);
    const row = await db.query.supportTickets.findFirst({
      where: eq(schema.supportTickets.supportCode, first.body.support_code),
    });
    expect(row).toMatchObject({
      category: 'support.printer',
      message: 'Printer not printing\n\nKOT stuck',
      status: 'open',
    });
  });

  it('answers 404 not_available for features that are not built yet', async () => {
    const pos = await registerPos(app);
    const res = await posCall(app, pos, 'POST', '/api/pos/diagnostics/v2', {}).expect(404);
    expect(res.body.error).toBe('not_available');
  });
});

describe('register rate limit', () => {
  it('allows 10 registrations per hour from one address', async () => {
    process.env.REGISTER_LIMIT_PER_HOUR = '10';
    const fresh = await createTestApp(url);
    try {
      for (let i = 0; i < 10; i++) {
        await request(fresh.getHttpServer())
          .post('/api/pos/register')
          .send(registerBody())
          .expect(200);
      }
      await request(fresh.getHttpServer())
        .post('/api/pos/register')
        .send(registerBody())
        .expect(429);
    } finally {
      await fresh.close();
    }
  });
});
