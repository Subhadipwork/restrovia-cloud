/** Owner portal menu: what the POS sends, who can see it, and the sold-out switch. */
import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service.js';
import * as schema from '../src/db/schema/index.js';
import {
  createTestApp,
  eventsBody,
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

type Pos = PosIdentity & { storeId: string };

beforeAll(async () => {
  ({ pool, db } = await resetDatabase(url));
  process.env.OWNER_AUTH_LIMIT = '1000';
  app = await createTestApp(url);
  await app.listen(0);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
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
  return agent;
}

async function seen(storeId: string, minutesAgo: number) {
  await db
    .update(schema.posDevices)
    .set({ lastHeartbeatAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(schema.posDevices.storeId, storeId));
}

function menuPayload(overrides: Record<string, unknown> = {}, generatedAt = new Date()) {
  return {
    version: 1,
    generated_at: generatedAt.toISOString(),
    sync_enabled: true,
    portal_editing: true,
    hash: createHash('sha256').update(randomUUID()).digest('hex'),
    categories: [{ id: 'c1', name: 'Drinks', sort_order: 0, is_active: 1 }],
    products: [
      {
        id: 'p1',
        category_id: 'c1',
        name: 'Latte',
        price: 120,
        cost: 40,
        is_active: 1,
        track_inventory: 1,
        stock_quantity: 9,
        tags: 'hot',
      },
      { id: 'p2', category_id: 'c1', name: 'Mocha', price: 150, cost: 55, is_active: 1 },
    ],
    variants: [{ id: 'v1', product_id: 'p1', name: 'Large', price: 160, online_price: 170 }],
    addon_groups: [{ id: 'g1', name: 'Milk', is_required: 0, min_selection: 0, max_selection: 1 }],
    addons: [{ id: 'a1', addon_group_id: 'g1', name: 'Oat', price: 20, is_active: 1 }],
    addon_group_products: [{ product_id: 'p1', addon_group_id: 'g1' }],
    category_addon_groups: [],
    ...overrides,
  };
}

async function sendMenu(pos: Pos, payload: unknown, type = 'menu.snapshot') {
  const res = await posCall(
    app,
    pos,
    'POST',
    '/api/pos/events',
    eventsBody(pos, [{ id: randomUUID(), type, entity_type: 'menu', entity_id: 'store', payload }]),
  ).expect(200);
  return res.body as { accepted: number; rejected: number };
}

/** Answers the next menu.set_availability command the way the POS does. */
async function answerAsPos(pos: Pos, answer: { ok: boolean; error?: string }) {
  for (let i = 0; i < 60; i++) {
    const res = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
    const command = res.body.commands[0];
    if (command) {
      await posCall(app, pos, 'POST', `/api/pos/commands/${command.id}/result`, {
        version: 1,
        correlation_id: command.id,
        ok: answer.ok,
        result: answer.ok ? { accepted: true } : undefined,
        error: answer.error,
        completed_at: new Date().toISOString(),
      }).expect(200);
      return command as { id: string; type: string; payload: Record<string, unknown> };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('No command reached the POS');
}

const commandsFor = (storeId: string) =>
  db.select().from(schema.commands).where(eq(schema.commands.storeId, storeId));

describe('the menu the POS sends', () => {
  it('shows the menu grouped, hides cost from managers and keeps the snapshot out of sync_events', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    const manager = await ownerOf(pos.storeId, 'manager');

    const empty = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(empty.body).toMatchObject({ has_menu: false, items: [], sync: { enabled: true } });

    expect(await sendMenu(pos, menuPayload())).toMatchObject({ accepted: 1, rejected: 0 });

    const res = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(res.body.has_menu).toBe(true);
    expect(res.body.categories).toEqual([
      expect.objectContaining({ id: 'c1', name: 'Drinks', is_active: true }),
    ]);
    const latte = res.body.items.find((i: { id: string }) => i.id === 'p1');
    expect(latte).toMatchObject({
      name: 'Latte',
      price: 120,
      cost: 40,
      is_active: true,
      track_inventory: true,
      addon_group_ids: ['g1'],
      variants: [{ id: 'v1', name: 'Large', price: 160, online_price: 170 }],
    });
    expect(res.body.addon_groups[0]).toMatchObject({
      id: 'g1',
      options: [{ id: 'a1', name: 'Oat', price: 20 }],
    });

    const asManager = await manager.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(asManager.body.items[0].cost).toBeNull();

    const [event] = await db
      .select()
      .from(schema.syncEvents)
      .where(eq(schema.syncEvents.storeId, pos.storeId));
    expect(event.type).toBe('menu.snapshot');
    expect(event.payload).toBeNull();
  });

  it('keeps the newest snapshot and ignores an older one', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    const now = Date.now();
    await sendMenu(pos, menuPayload({ products: [{ id: 'new', name: 'Newest', price: 1 }] }, new Date(now)));
    await sendMenu(
      pos,
      menuPayload({ products: [{ id: 'old', name: 'Older', price: 1 }] }, new Date(now - 60_000)),
    );
    const res = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['new']);
  });

  it('counts an unusable snapshot as rejected and keeps the last good menu', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    await sendMenu(pos, menuPayload());
    expect(await sendMenu(pos, { version: 1, products: 'nope' })).toMatchObject({ rejected: 1 });
    const res = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('never shows one café’s menu to another café’s owner', async () => {
    const mine = await registerPos(app);
    const other = await registerPos(app);
    await ownerOf(mine.storeId);
    const intruder = await ownerOf(other.storeId);
    await sendMenu(mine, menuPayload());
    await intruder.get(`/api/owner/stores/${mine.storeId}/menu`).expect(404);
    await intruder
      .post(`/api/owner/stores/${mine.storeId}/menu/items/p1/availability`)
      .set(CSRF)
      .send({ available: false })
      .expect(404);
    expect(await commandsFor(mine.storeId)).toHaveLength(0);
  });
});

describe('sold out from the portal', () => {
  const toggle = (agent: ReturnType<typeof request.agent>, pos: Pos, id: string, available: boolean) =>
    agent
      .post(`/api/owner/stores/${pos.storeId}/menu/items/${id}/availability`)
      .set(CSRF)
      .send({ available });

  it('asks the POS, then shows the change', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    await sendMenu(pos, menuPayload());
    await seen(pos.storeId, 1);

    const pending = toggle(owner, pos, 'p1', false).then((r) => r);
    const command = await answerAsPos(pos, { ok: true });
    const res = await pending;
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'p1', is_active: false });
    expect(command.type).toBe('menu.set_availability');
    expect(command.payload).toEqual({ product_id: 'p1', available: false });

    const menu = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    const byId = (id: string) => menu.body.items.find((i: { id: string }) => i.id === id);
    expect(byId('p1').is_active).toBe(false);
    expect(byId('p2').is_active).toBe(true);
  });

  it('leaves the menu alone when the POS refuses', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    await sendMenu(pos, menuPayload());
    await seen(pos.storeId, 1);

    const pending = toggle(owner, pos, 'p1', false).then((r) => r);
    await answerAsPos(pos, { ok: false, error: 'Item not found on this POS' });
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'pos_refused', message: 'Item not found on this POS' });
    const menu = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(menu.body.items.find((i: { id: string }) => i.id === 'p1').is_active).toBe(true);
  });

  it('refuses without asking the POS when it is offline, the item is unknown or a switch is off', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    await toggle(owner, pos, 'p1', false).expect(404); // no menu yet
    await sendMenu(pos, menuPayload());

    await seen(pos.storeId, 30);
    expect((await toggle(owner, pos, 'p1', false).expect(409)).body.error).toBe('pos_offline');

    await seen(pos.storeId, 1);
    await toggle(owner, pos, 'nope', false).expect(404);

    await sendMenu(pos, { sync_enabled: true, portal_editing: false, occurred_at: new Date().toISOString() }, 'menu.sync_state');
    expect((await toggle(owner, pos, 'p1', false).expect(403)).body.error).toBe('portal_editing_off');

    await sendMenu(pos, { sync_enabled: false, portal_editing: true, occurred_at: new Date().toISOString() }, 'menu.sync_state');
    expect((await toggle(owner, pos, 'p1', false).expect(409)).body.error).toBe('menu_sync_off');
    const menu = await owner.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200);
    expect(menu.body.sync).toMatchObject({ enabled: false, portal_editing: true });
    expect(menu.body.items).toHaveLength(2); // sync off freezes the copy, it does not empty it
    expect(await commandsFor(pos.storeId)).toHaveLength(0);
  });

  it('needs the owner header and a boolean', async () => {
    const pos = await registerPos(app);
    const owner = await ownerOf(pos.storeId);
    await sendMenu(pos, menuPayload());
    await seen(pos.storeId, 1);
    await owner
      .post(`/api/owner/stores/${pos.storeId}/menu/items/p1/availability`)
      .send({ available: false })
      .expect(403);
    await toggle(owner, pos, 'p1', 'yes' as unknown as boolean).expect(400);
    expect(await commandsFor(pos.storeId)).toHaveLength(0);
  });
});
