/** The POS Marketplace endpoints, and keeping features a POS already used before add-ons. */
import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import type { LicenceClaims } from '@restrovia/shared';
import * as schema from '../src/db/schema/index.js';
import { createTestApp, posCall, registerPos, resetDatabase, testDatabaseUrl } from './helpers.js';

const url = testDatabaseUrl();
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let app: NestExpressApplication;
const DAY = 86_400_000;
type Pos = Awaited<ReturnType<typeof registerPos>>;

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  app = await createTestApp(url);
  await db.insert(schema.plans).values({
    code: 'growth_monthly',
    name: 'Growth',
    price: '1499.00',
    interval: 'month',
    features: { kiosk: true },
  });
  await db.update(schema.addons).set({ status: 'live' }).where(eq(schema.addons.code, 'kiosk'));
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function onGrowth(pos: Pos) {
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.code, 'growth_monthly'));
  await db
    .update(schema.subscriptions)
    .set({ status: 'cancelled' })
    .where(eq(schema.subscriptions.storeId, pos.storeId));
  await db.insert(schema.subscriptions).values({
    storeId: pos.storeId,
    planId: plan.id,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 20 * DAY),
  });
}

async function checkIn(pos: Pos, enabledFeatures?: string[]) {
  const res = await posCall(app, pos, 'POST', '/api/pos/licence', {
    pos_hash: pos.posHash,
    machine_id_hash: createHash('sha256').update(`machine:${pos.posHash}`).digest('hex'),
    app_version: '3.15.0',
    ...(enabledFeatures && { enabled_features: enabledFeatures }),
  }).expect(200);
  return JSON.parse(
    Buffer.from(res.body.token.split('.')[0], 'base64url').toString(),
  ) as LicenceClaims;
}

const list = async (pos: Pos) =>
  (await posCall(app, pos, 'GET', '/api/pos/marketplace').expect(200)).body.addons as {
    code: string;
    state: string;
    can_add_free: boolean;
    can_start_trial: boolean;
    ends_at: string | null;
  }[];
const add = (pos: Pos, code: string, mode: 'free' | 'trial') =>
  posCall(app, pos, 'POST', `/api/pos/marketplace/${code}/add`, { mode });

describe('POS marketplace', () => {
  it('lists live add-ons with this store’s state, marking plan features', async () => {
    const pos = await registerPos(app);
    await onGrowth(pos);
    const addons = await list(pos);
    expect(addons.map((a) => a.code)).toEqual(['whatsapp', 'tableside', 'kiosk']);
    expect(addons.find((a) => a.code === 'kiosk')).toMatchObject({ state: 'in_plan' });
    expect(addons.find((a) => a.code === 'tableside')).toMatchObject({
      state: 'available',
      can_add_free: true,
      can_start_trial: false,
    });
    expect(addons.find((a) => a.code === 'whatsapp')).toMatchObject({
      can_add_free: false,
      can_start_trial: true,
    });
  });

  it('adds a free add-on, which then appears in the licence', async () => {
    const pos = await registerPos(app);
    await onGrowth(pos);
    expect((await checkIn(pos)).features).toEqual(['kiosk']);
    const res = await add(pos, 'tableside', 'free').expect(201);
    expect(res.body).toMatchObject({ code: 'tableside', status: 'active', ends_at: null });
    expect((await checkIn(pos)).features).toEqual(['tableside', 'kiosk']);
    expect((await list(pos)).find((a) => a.code === 'tableside')?.state).toBe('active');
    await add(pos, 'tableside', 'free').expect(409);
    const commands = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.storeId, pos.storeId));
    expect(commands.map((c) => c.type)).toContain('licence.refresh');
  });

  it('starts a paid add-on’s trial once, and refuses adding it free', async () => {
    const pos = await registerPos(app);
    await onGrowth(pos);
    const free = await add(pos, 'whatsapp', 'free');
    expect(free.status).toBe(402);
    expect(free.body.error).toBe('payment_required');
    const trial = await add(pos, 'whatsapp', 'trial').expect(201);
    expect(trial.body.status).toBe('trial');
    expect(Date.parse(trial.body.ends_at) - Date.now()).toBeGreaterThan(13 * DAY);
    expect((await checkIn(pos)).features).toEqual(['whatsapp', 'kiosk']);

    await db
      .update(schema.storeAddons)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(schema.storeAddons.storeId, pos.storeId));
    expect((await list(pos)).find((a) => a.code === 'whatsapp')).toMatchObject({
      state: 'available',
      can_start_trial: false,
    });
    const again = await add(pos, 'whatsapp', 'trial');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('addon_trial_used');
  });

  it('hides draft add-ons and refuses unsigned calls', async () => {
    const pos = await registerPos(app);
    await db.update(schema.addons).set({ status: 'draft' }).where(eq(schema.addons.code, 'kiosk'));
    expect((await list(pos)).map((a) => a.code)).not.toContain('kiosk');
    await add(pos, 'kiosk', 'free').expect(404);
    await db.update(schema.addons).set({ status: 'live' }).where(eq(schema.addons.code, 'kiosk'));
    await request(app.getHttpServer()).get('/api/pos/marketplace').expect(401);
  });
});

describe('keeping features in use before add-ons', () => {
  it('keeps reported features free, once, except ones the plan includes', async () => {
    const pos = await registerPos(app);
    await onGrowth(pos);
    const claims = await checkIn(pos, ['whatsapp', 'kiosk', 'tableside', 'made_up']);
    expect(claims.features).toEqual(['whatsapp', 'tableside', 'kiosk']);
    const rows = await db
      .select({ source: schema.storeAddons.source, end: schema.storeAddons.currentPeriodEnd })
      .from(schema.storeAddons)
      .where(eq(schema.storeAddons.storeId, pos.storeId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'grandfathered' && r.end === null)).toBe(true);

    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(
        and(
          eq(schema.adminAuditLog.targetId, pos.storeId),
          eq(schema.adminAuditLog.action, 'store_addon.grandfather'),
        ),
      );
    expect(audit[0].details).toMatchObject({
      reported: ['whatsapp', 'tableside', 'kiosk'],
      kept: ['whatsapp', 'tableside'],
    });
  });

  it('gives a store without a plan only the features it used and the add-ons it adds', async () => {
    const pos = await registerPos(app);
    expect((await checkIn(pos, ['tableside'])).features).toEqual(['tableside']);
    await add(pos, 'whatsapp', 'trial').expect(201);
    expect((await checkIn(pos)).features).toEqual(['whatsapp', 'tableside']);
  });

  it('does it only on the first report, so turning a feature on later gives nothing', async () => {
    const pos = await registerPos(app);
    await onGrowth(pos);
    expect((await checkIn(pos, [])).features).toEqual(['kiosk']);
    expect((await checkIn(pos, ['whatsapp'])).features).toEqual(['kiosk']);
  });

  it('never re-grants an add-on the store had before', async () => {
    const pos = await registerPos(app);
    await onGrowth(pos);
    await add(pos, 'whatsapp', 'trial').expect(201);
    await db
      .update(schema.storeAddons)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(schema.storeAddons.storeId, pos.storeId));
    expect((await checkIn(pos, ['whatsapp'])).features).toEqual(['kiosk']);
  });
});
