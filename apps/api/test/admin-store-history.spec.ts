/** The admin store history page: online time per day, order flow, sales and top items. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
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
} from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;

const CSRF = { 'X-Restrovia-Admin': '1' };
const PASSWORD = 'tea garden 42';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Noon in Kolkata, where the test stores are, so every order falls on one business day.
const NOW = new Date('2026-11-10T06:30:00.000Z');

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.ADMIN_LOGIN_LIMIT = '1000';
  app = await createTestApp(url);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function adminAgent() {
  const email = `support-${randomUUID().slice(0, 8)}@restrovia.test`;
  await db.insert(schema.admins).values({
    name: 'Test support',
    email,
    roleId: SYSTEM_ROLE_IDS.support,
    passwordHash: await app.get(CryptoService).hashPassword(PASSWORD),
  });
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/admin/auth/login')
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  return agent;
}

const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('store history', () => {
  it('shows online time per day, order flow, sales and top items', async () => {
    const pos = await registerPos(app);
    const done = orderSnapshot(1, { createdAt: ago(60 * MINUTE), paidAt: ago(30 * MINUTE) });
    const open = orderSnapshot(2, { createdAt: ago(20 * MINUTE), paidAt: null });
    const cancelled = {
      ...orderSnapshot(3, { createdAt: ago(50 * MINUTE), paidAt: null }),
      status: 'cancelled',
      cancelled_at: sqliteTime(ago(40 * MINUTE)),
    };
    await posCall(
      app,
      pos,
      'POST',
      '/api/pos/events',
      eventsBody(pos, [orderEvent(done), orderEvent(open), orderEvent(cancelled)]),
    ).expect(200);

    // Online 6 to 5 hours ago, then 3 to 1 hour ago; the overlapping period counts once.
    await db.insert(schema.posPresence).values(
      [
        [6 * HOUR, 5 * HOUR],
        [3 * HOUR, 1 * HOUR],
        [2 * HOUR, 1.5 * HOUR],
      ].map(([start, end]) => ({
        storeId: pos.storeId,
        deviceId: pos.posId,
        startedAt: ago(start),
        lastSeenAt: ago(end),
      })),
    );

    const agent = await adminAgent();
    const res = await agent
      .get(`/api/admin/stores/${pos.storeId}/history`)
      .query({ days: 7 })
      .expect(200);
    const body = res.body;
    expect(body).toMatchObject({ from: '2026-11-04', to: '2026-11-10', days: 7 });

    expect(body.online.by_day).toHaveLength(7);
    expect(body.online.by_day[6]).toEqual({
      day: '2026-11-10',
      recorded: true,
      online_seconds: 3 * 3600,
      // Recording began 6 hours ago, so the day counts from then: 3 of 6 hours.
      uptime_pct: 50,
      sessions: 3,
    });
    expect(body.online.by_day[0]).toMatchObject({ recorded: false, uptime_pct: null });
    expect(body.online.uptime_pct).toBe(50);

    expect(body.orders.totals).toMatchObject({
      orders: 3,
      completed: 1,
      cancelled: 1,
      median_complete_seconds: 30 * 60,
    });
    expect(body.orders.by_day).toHaveLength(7);
    expect(body.orders.by_day[6]).toEqual({
      day: '2026-11-10',
      orders: 3,
      completed: 1,
      cancelled: 1,
      avg_complete_seconds: 30 * 60,
    });
    expect(body.orders.by_day[0]).toMatchObject({ orders: 0, avg_complete_seconds: null });
    expect(body.orders.by_status).toEqual(
      expect.arrayContaining([
        { status: 'completed', count: 1 },
        { status: 'served', count: 1 },
        { status: 'cancelled', count: 1 },
      ]),
    );

    expect(body.sales_by_day).toHaveLength(7);
    expect(body.sales_by_day[6]).toMatchObject({ day: '2026-11-10', bills_count: 1 });
    expect(body.top_items.items[0]).toMatchObject({ name: 'Cappuccino' });
    expect(body.hours.hours).toHaveLength(24);
  });

  it('only offers 7, 30 or 90 days, and answers 404 for an unknown store', async () => {
    const pos = await registerPos(app);
    const agent = await adminAgent();
    const res = await agent.get(`/api/admin/stores/${pos.storeId}/history`).expect(200);
    expect(res.body.days).toBe(30);
    await agent.get(`/api/admin/stores/${pos.storeId}/history`).query({ days: 14 }).expect(400);
    await agent.get(`/api/admin/stores/${randomUUID()}/history`).expect(404);
  });
});
