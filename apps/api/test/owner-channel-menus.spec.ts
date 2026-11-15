/** Owner portal menus for each way of selling: prices that differ from the Base Menu, and hidden items. */
import { createHash, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
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


const url_ = (storeId: string, path = '') => `/api/owner/stores/${storeId}/menus${path}`;

async function setup() {
  const pos = await registerPos(app);
  const agent = await ownerOf(pos.storeId);
  await sendMenu(pos, menuPayload());
  const list = (await agent.get(url_(pos.storeId)).expect(200)).body;
  const menu = (name: string) => list.menus.find((m: { name: string }) => m.name === name).id as string;
  return { pos, agent, list, menu };
}

describe('menus for each way of selling', () => {
  it('starts every café with the usual menus and the Base Menu', async () => {
    const { list } = await setup();
    expect(list.has_menu).toBe(true);
    expect(list.base).toEqual({ id: 'base', name: 'Base Menu', item_count: 2 });
    expect(list.menus.map((m: { name: string }) => m.name)).toEqual([
      'Home Delivery', 'Parcel', 'Dine In', 'Home Website', 'Pick Up Menu QR',
    ]);
    expect(list.menus.every((m: { built_in: boolean; priced_items: number }) => m.built_in && m.priced_items === 0)).toBe(true);
  });

  it('shows the Base Menu price and lets a menu differ from it', async () => {
    const { pos, agent, menu } = await setup();
    const delivery = menu('Home Delivery');
    let view = (await agent.get(url_(pos.storeId, `/${delivery}`)).expect(200)).body;
    const latte = () => view.items.find((i: { id: string }) => i.id === 'p1');
    expect(latte()).toMatchObject({ base_price: 120, price: null, effective_price: 120, hidden: false });
    expect(latte().variants).toEqual([
      { id: 'v1', name: 'Large', base_price: 160, price: null, effective_price: 160 },
    ]);

    const put = (id: string, body: object) =>
      agent.put(url_(pos.storeId, `/${delivery}/items/${id}`)).set(CSRF).send(body);
    const res = await put('p1', { price: 140, variants: [{ variant_id: 'v1', price: 185 }] }).expect(200);
    expect(res.body.item).toMatchObject({ price: 140, effective_price: 140, hidden: false });
    expect(res.body.item.variants[0]).toMatchObject({ price: 185, effective_price: 185 });
    await put('p2', { hidden: true }).expect(200);

    view = (await agent.get(url_(pos.storeId, `/${delivery}`)).expect(200)).body;
    expect(view.items.find((i: { id: string }) => i.id === 'p2')).toMatchObject({ hidden: true, price: null });

    // Other menus and the Base Menu are untouched.
    const parcel = (await agent.get(url_(pos.storeId, `/${menu('Parcel')}`)).expect(200)).body;
    expect(parcel.items.find((i: { id: string }) => i.id === 'p1')).toMatchObject({ price: null, hidden: false });
    const base = (await agent.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200)).body;
    expect(base.items.find((i: { id: string }) => i.id === 'p1').price).toBe(120);

    const counts = (await agent.get(url_(pos.storeId)).expect(200)).body.menus.find((m: { id: string }) => m.id === delivery);
    expect(counts).toMatchObject({ priced_items: 1, hidden_items: 1 });
  });

  it('forgets a difference that matches the Base Menu or is cleared', async () => {
    const { pos, agent, menu } = await setup();
    const id = menu('Dine In');
    const put = (body: object) => agent.put(url_(pos.storeId, `/${id}/items/p1`)).set(CSRF).send(body);
    await put({ price: 130 }).expect(200);
    expect((await put({ price: 120 }).expect(200)).body.item).toMatchObject({ price: null, effective_price: 120 });
    await put({ price: 130, hidden: true }).expect(200);
    expect((await put({ price: null }).expect(200)).body.item).toMatchObject({ price: null, hidden: true });
    await put({ hidden: false }).expect(200);
    const counts = (await agent.get(url_(pos.storeId)).expect(200)).body.menus.find((m: { id: string }) => m.id === id);
    expect(counts).toMatchObject({ priced_items: 0, hidden_items: 0 });
    await put({ variants: [{ variant_id: 'v1', price: 170 }] }).expect(200);
    await put({ variants: [{ variant_id: 'v1', price: 160 }] }).expect(200); // back to the Base Menu price
    expect((await agent.get(url_(pos.storeId, `/${id}`)).expect(200)).body.items[0].variants[0].price).toBeNull();
  });

  it('refuses bad prices, unknown items and sizes, and empty changes', async () => {
    const { pos, agent, menu } = await setup();
    const id = menu('Parcel');
    const put = (item: string, body: object) => agent.put(url_(pos.storeId, `/${id}/items/${item}`)).set(CSRF).send(body);
    await put('p1', { price: -1 }).expect(400);
    await put('p1', { price: '12' }).expect(400);
    await put('p1', {}).expect(400);
    await put('ghost', { price: 5 }).expect(404);
    await put('p1', { variants: [{ variant_id: 'nope', price: 5 }] }).expect(400);
    await put('p2', { variants: [{ variant_id: 'v1', price: 5 }] }).expect(400); // v1 belongs to p1
    await agent.put(url_(pos.storeId, `/${id}/items/p1`)).send({ price: 5 }).expect(403); // owner header
  });

  it('adds, protects and removes menus, and resets one to the Base Menu', async () => {
    const { pos, agent, menu } = await setup();
    const created = await agent.post(url_(pos.storeId)).set(CSRF).send({ name: 'Happy hour' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Happy hour', built_in: false });
    await agent.post(url_(pos.storeId)).set(CSRF).send({ name: 'happy HOUR' }).expect(409);
    await agent.post(url_(pos.storeId)).set(CSRF).send({ name: '  ' }).expect(400);
    await agent.delete(url_(pos.storeId, `/${menu('Dine In')}`)).set(CSRF).expect(400); // built in

    await agent.put(url_(pos.storeId, `/${created.body.id}/items/p1`)).set(CSRF).send({ price: 99, hidden: true }).expect(200);
    await agent.post(url_(pos.storeId, `/${created.body.id}/reset`)).set(CSRF).expect(201);
    expect((await agent.get(url_(pos.storeId, `/${created.body.id}`)).expect(200)).body.items[0]).toMatchObject({ price: null, hidden: false });

    await agent.delete(url_(pos.storeId, `/${created.body.id}`)).set(CSRF).expect(200);
    await agent.get(url_(pos.storeId, `/${created.body.id}`)).expect(404);
  });

  it('keeps each café’s menus to its own people', async () => {
    const { pos, menu } = await setup();
    const other = await registerPos(app);
    const stranger = await ownerOf(other.storeId);
    await stranger.get(url_(pos.storeId)).expect(404);
    await stranger.get(url_(pos.storeId, `/${menu('Parcel')}`)).expect(404);
    await stranger.put(url_(pos.storeId, `/${menu('Parcel')}/items/p1`)).set(CSRF).send({ price: 1 }).expect(404);
    // A menu id from another café is not found through your own café.
    const mine = await ownerOf(other.storeId);
    await sendMenu(other, menuPayload());
    await mine.get(url_(other.storeId, `/${menu('Parcel')}`)).expect(404);
  });

  it('works before the POS has sent its menu', async () => {
    const pos = await registerPos(app);
    const agent = await ownerOf(pos.storeId);
    const list = (await agent.get(url_(pos.storeId)).expect(200)).body;
    expect(list).toMatchObject({ has_menu: false, base: { item_count: 0 } });
    const view = (await agent.get(url_(pos.storeId, `/${list.menus[0].id}`)).expect(200)).body;
    expect(view).toMatchObject({ has_menu: false, items: [] });
  });
});
