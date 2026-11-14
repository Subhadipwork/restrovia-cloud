/** Owner portal menu edits: drafts, publishing to the POS, its answers, and who may change what. */
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

const commandsFor = (storeId: string) =>
  db.select().from(schema.commands).where(eq(schema.commands.storeId, storeId));


const base = (storeId: string) => `/api/owner/stores/${storeId}/menu/changes`;
const draft = (agent: ReturnType<typeof request.agent>, pos: Pos, body: object) =>
  agent.post(base(pos.storeId)).set(CSRF).send(body);
const publish = (agent: ReturnType<typeof request.agent>, pos: Pos) =>
  agent.post(`${base(pos.storeId)}/publish`).set(CSRF);

async function setup(role: 'owner' | 'manager' = 'owner') {
  const pos = await registerPos(app);
  const agent = await ownerOf(pos.storeId, role);
  await sendMenu(pos, menuPayload());
  return { pos, agent };
}

/** Takes the next menu.apply_changes command the way the POS does, and answers it. */
async function answerAsPos(pos: Pos, answer: (changes: { id: string }[]) => Record<string, unknown>) {
  const res = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
  const command = res.body.commands[0];
  expect(command.type).toBe('menu.apply_changes');
  await posCall(app, pos, 'POST', `/api/pos/commands/${command.id}/result`, {
    version: 1,
    correlation_id: command.id,
    ok: true,
    result: answer(command.payload.changes),
    completed_at: new Date().toISOString(),
  }).expect(200);
  return command as { id: string; payload: { changes: Record<string, unknown>[] } };
}

describe('drafts', () => {
  it('records what the POS has now as the starting value and merges repeated edits', async () => {
    const { pos, agent } = await setup();
    let res = await draft(agent, pos, {
      op: 'update',
      entity: 'item',
      entity_id: 'p1',
      fields: { price: 130, name: 'Latte' },
    }).expect(201);
    expect(res.body.draft).toMatchObject({
      status: 'draft',
      label: 'Latte',
      fields: { price: { from: 120, to: 130 } }, // the unchanged name is dropped
    });

    res = await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 140, sku: 'LAT' } }).expect(201);
    expect(res.body.draft.fields).toEqual({
      price: { from: 120, to: 140 },
      sku: { from: null, to: 'LAT' },
    });
    expect((await agent.get(base(pos.storeId)).expect(200)).body.changes).toHaveLength(1);

    // Putting everything back removes the draft.
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 120, sku: null } }).expect(201);
    expect((await agent.get(base(pos.storeId)).expect(200)).body.changes).toHaveLength(0);
  });

  it('refuses what the POS would refuse, and fields the portal may not touch', async () => {
    const { pos, agent } = await setup();
    const update = (fields: unknown, id = 'p1') =>
      draft(agent, pos, { op: 'update', entity: 'item', entity_id: id, fields });
    await update({ stock_quantity: 5 }).expect(400);
    await update({ price: -1 }).expect(400);
    await update({ price: '12' }).expect(400);
    await update({ name: '   ' }).expect(400);
    await update({ category_id: 'nope' }).expect(400);
    await update({ price: 1 }, 'missing').expect(404);
    await update({ price: 120 }).expect(400); // nothing changes
    await draft(agent, pos, { op: 'create', entity: 'item', fields: { name: 'Tea' } }).expect(400);
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { price: 5 } }).expect(400);
    expect((await agent.get(base(pos.storeId)).expect(200)).body.changes).toHaveLength(0);
  });

  it('lets a delete replace earlier edits of the same item', async () => {
    const { pos, agent } = await setup();
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 130 } }).expect(201);
    await draft(agent, pos, { op: 'delete', entity: 'item', entity_id: 'p1' }).expect(201);
    const list = (await agent.get(base(pos.storeId)).expect(200)).body.changes;
    expect(list.map((c: { op: string }) => c.op)).toEqual(['delete']);
  });

  it('keeps cost to owners and the café’s menu to its own people', async () => {
    const { pos, agent } = await setup('manager');
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { cost_price: 50 } }).expect(403);

    const other = await registerPos(app);
    const stranger = await ownerOf(other.storeId);
    await draft(stranger, pos, { op: 'create', entity: 'category', fields: { name: 'Hijack' } }).expect(404);
    await stranger.get(base(pos.storeId)).expect(404);
    await stranger.post(`${base(pos.storeId)}/publish`).set(CSRF).expect(404);
  });

  it('needs the owner header, and a menu that has synced', async () => {
    const pos = await registerPos(app);
    const agent = await ownerOf(pos.storeId);
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'A' } }).expect(404);
    await sendMenu(pos, menuPayload());
    await agent
      .post(base(pos.storeId))
      .send({ op: 'create', entity: 'category', fields: { name: 'A' } })
      .expect(403);
  });

  it('discards a draft but not a change already sent to the POS', async () => {
    const { pos, agent } = await setup();
    const first = await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'Snacks' } }).expect(201);
    await agent.delete(`${base(pos.storeId)}/${first.body.draft.id}`).set(CSRF).expect(200);
    await agent.delete(`${base(pos.storeId)}/${first.body.draft.id}`).set(CSRF).expect(404);

    const second = await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'Snacks' } }).expect(201);
    await publish(agent, pos).expect(201);
    await agent.delete(`${base(pos.storeId)}/${second.body.draft.id}`).set(CSRF).expect(404);
  });
});

describe('publishing', () => {
  it('sends one durable command, even while the POS is offline, and refuses a second publish', async () => {
    const { pos, agent } = await setup();
    await seen(pos.storeId, 600);
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 130 } }).expect(201);
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'Snacks' } }).expect(201);
    await draft(agent, pos, { op: 'delete', entity: 'item', entity_id: 'p2' }).expect(201);

    expect((await publish(agent, pos).expect(201)).body).toEqual({ published: 3 });
    await publish(agent, pos).expect(400);

    const [command] = await commandsFor(pos.storeId);
    expect(command).toMatchObject({ type: 'menu.apply_changes', status: 'queued' });
    expect(command.expiresAt.getTime() - Date.now()).toBeGreaterThan(5 * 86_400_000);
    const changes = (command.payload as { changes: Record<string, unknown>[] }).changes;
    expect(changes).toHaveLength(3);
    expect(changes[0]).toMatchObject({ entity: 'item', op: 'update', entity_id: 'p1', fields: { price: { from: 120, to: 130 } } });
    expect(String(changes[0].requested_by)).toMatch(/^Owner portal: /);

    const list = (await agent.get(base(pos.storeId)).expect(200)).body.changes;
    expect(list.map((c: { status: string }) => c.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('shows each answer: applied, conflict with the POS value, rejected, and the new id', async () => {
    const { pos, agent } = await setup();
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 130 } }).expect(201);
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p2', fields: { price: 160 } }).expect(201);
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'Snacks' } }).expect(201);
    await draft(agent, pos, { op: 'delete', entity: 'category', entity_id: 'c1' }).expect(201);
    await publish(agent, pos).expect(201);

    await answerAsPos(pos, (changes) => ({
      results: [
        { id: changes[0].id, status: 'applied', entity_id: 'p1' },
        { id: changes[1].id, status: 'conflict', entity_id: 'p2', current: { price: 155 } },
        { id: changes[2].id, status: 'applied', entity_id: 'c-new' },
        { id: changes[3].id, status: 'rejected', error: 'Not found on this POS' },
      ],
    }));

    const list = (await agent.get(base(pos.storeId)).expect(200)).body.changes as {
      op: string;
      entity: string;
      status: string;
      entity_id: string | null;
      result: Record<string, unknown> | null;
    }[];
    const find = (op: string, status: string) => list.find((c) => c.op === op && c.status === status);
    expect(list.filter((c) => c.status === 'applied')).toHaveLength(2);
    expect(find('update', 'conflict')?.result).toMatchObject({ current: { price: 155 } });
    expect(find('create', 'applied')?.entity_id).toBe('c-new');
    expect(find('delete', 'rejected')?.result).toMatchObject({ error: 'Not found on this POS' });
  });

  it('marks everything rejected when the POS refuses the batch, and expired when it never came back', async () => {
    const { pos, agent } = await setup();
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'A' } }).expect(201);
    await publish(agent, pos).expect(201);
    const [command] = await commandsFor(pos.storeId);
    await db
      .update(schema.commands)
      .set({ status: 'failed', error: 'Portal editing is off on this POS' })
      .where(eq(schema.commands.id, command.id));
    let list = (await agent.get(base(pos.storeId)).expect(200)).body.changes;
    expect(list[0]).toMatchObject({ status: 'rejected', result: { error: 'Portal editing is off on this POS' } });

    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'B' } }).expect(201);
    await publish(agent, pos).expect(201);
    await db
      .update(schema.commands)
      .set({ status: 'expired', expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.commands.status, 'queued'));
    list = (await agent.get(base(pos.storeId)).expect(200)).body.changes;
    expect(list.find((c: { label: string }) => c.label === 'B').status).toBe('expired');
  });

  it('hands the batch to the POS again if it took it and never answered', async () => {
    const { pos, agent } = await setup();
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'A' } }).expect(201);
    await publish(agent, pos).expect(201);

    const first = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
    expect(first.body.commands).toHaveLength(1);
    const again = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
    expect(again.body.commands).toHaveLength(0); // too soon

    await db
      .update(schema.commands)
      .set({ sentAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.commands.id, first.body.commands[0].id));
    const later = await posCall(app, pos, 'GET', '/api/pos/commands?limit=5').expect(200);
    expect(later.body.commands.map((c: { id: string }) => c.id)).toEqual([first.body.commands[0].id]);
  });

  it('lets a manager make small price changes but asks for the owner on big ones', async () => {
    const { pos, agent } = await setup('manager');
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 200 } }).expect(201);
    const refused = await publish(agent, pos).expect(403);
    expect(refused.body).toMatchObject({ error: 'owner_approval_needed', message: 'Latte' });
    expect(await commandsFor(pos.storeId)).toHaveLength(0);

    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 140 } }).expect(201);
    await publish(agent, pos).expect(201);
  });

  it('refuses to publish while sync or portal editing is off', async () => {
    const { pos, agent } = await setup();
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'A' } }).expect(201);
    const state = (sync: boolean, editing: boolean) =>
      sendMenu(pos, { sync_enabled: sync, portal_editing: editing, occurred_at: new Date().toISOString() }, 'menu.sync_state');
    await state(true, false);
    expect((await publish(agent, pos).expect(403)).body.error).toBe('portal_editing_off');
    await state(false, true);
    expect((await publish(agent, pos).expect(409)).body.error).toBe('menu_sync_off');
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'B' } }).expect(409);
    await state(true, true);
    await publish(agent, pos).expect(201);
  });
});

const post = (agent: ReturnType<typeof request.agent>, pos: Pos, path: string, body?: object) =>
  agent.post(`${base(pos.storeId)}/${path}`).set(CSRF).send(body ?? {});
const drafts = async (agent: ReturnType<typeof request.agent>, pos: Pos) =>
  ((await agent.get(base(pos.storeId)).expect(200)).body.changes as {
    id: string;
    op: string;
    entity: string;
    label: string;
    status: string;
    entity_id: string | null;
    fields: Record<string, { from?: unknown; to?: unknown }>;
  }[]).filter((c) => c.status === 'draft');

describe('sizes and add-ons', () => {
  it('drafts a size edit against the POS’s current sizes and refuses unknown ones', async () => {
    const { pos, agent } = await setup();
    const res = await draft(agent, pos, {
      op: 'update',
      entity: 'item',
      entity_id: 'p1',
      fields: {
        variants: [
          { id: 'v1', name: 'Large', price: 170, online_price: 180 },
          { name: 'Small', price: 100 },
        ],
      },
    }).expect(201);
    const { from, to } = res.body.draft.fields.variants;
    expect(from).toEqual([
      { id: 'v1', name: 'Large', price: 160, online_price: 170, sku: null, barcode: null, is_active: true, sort_order: 0 },
    ]);
    expect(to).toHaveLength(2);
    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p1', fields: { variants: [{ id: 'nope', name: 'x', price: 1 }] },
    }).expect(400);
    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p1', fields: { variants: [{ name: 'x', price: -1 }] },
    }).expect(400);
    // Re-sending the sizes as they are changes nothing.
    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p2', fields: { variants: [] },
    }).expect(400);
  });

  it('links add-on groups to an item and manages groups and options', async () => {
    const { pos, agent } = await setup();
    const attach = await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p2', fields: { addon_group_ids: ['g1'] },
    }).expect(201);
    expect(attach.body.draft.fields.addon_group_ids).toEqual({ from: [], to: ['g1'] });
    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p2', fields: { addon_group_ids: ['missing'] },
    }).expect(400);

    await draft(agent, pos, { op: 'create', entity: 'addon_group', fields: { name: 'Syrup', max_selection: 2 } }).expect(201);
    await draft(agent, pos, {
      op: 'update', entity: 'addon_group', entity_id: 'g1', fields: { max_selection: 3, is_required: true },
    }).expect(201);
    await draft(agent, pos, { op: 'create', entity: 'addon', fields: { name: 'Almond', price: 25 } }).expect(400); // no group
    await draft(agent, pos, { op: 'create', entity: 'addon', fields: { addon_group_id: 'nope', name: 'Almond', price: 25 } }).expect(400);
    await draft(agent, pos, { op: 'create', entity: 'addon', fields: { addon_group_id: 'g1', name: 'Almond', price: 25 } }).expect(201);
    const edit = await draft(agent, pos, {
      op: 'update', entity: 'addon', entity_id: 'a1', fields: { price: 30 },
    }).expect(201);
    expect(edit.body.draft).toMatchObject({ label: 'Oat', fields: { price: { from: 20, to: 30 } } });
    expect(await drafts(agent, pos)).toHaveLength(5);
  });

  it('asks for the owner when a manager moves a size price by more than 25%', async () => {
    const { pos, agent } = await setup('manager');
    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p1', fields: { variants: [{ id: 'v1', name: 'Large', price: 300, online_price: 170 }] },
    }).expect(201);
    expect((await publish(agent, pos).expect(403)).body.error).toBe('owner_approval_needed');
  });
});

describe('bulk edits, copies and imports', () => {
  it('moves prices by a percentage on items and their sizes, and reports what it skipped', async () => {
    const { pos, agent } = await setup();
    const res = await post(agent, pos, 'bulk', {
      item_ids: ['p1', 'p2', 'ghost'],
      action: { type: 'price_percent', value: 10 },
    }).expect(201);
    expect(res.body).toEqual({ drafted: 2, unchanged: 0, skipped: 1 });
    const list = await drafts(agent, pos);
    const p1 = list.find((c) => c.entity_id === 'p1')!;
    expect(p1.fields.price).toEqual({ from: 120, to: 132 });
    expect((p1.fields.variants.to as { price: number }[])[0].price).toBe(176);
    expect(list.find((c) => c.entity_id === 'p2')!.fields.price).toEqual({ from: 150, to: 165 });

    // The same action again is a no-op only for items already at the target.
    const hide = await post(agent, pos, 'bulk', { item_ids: ['p1', 'p2'], action: { type: 'set_active', value: false } }).expect(201);
    expect(hide.body.drafted).toBe(2);
    const again = await post(agent, pos, 'bulk', { item_ids: ['p1', 'p2'], action: { type: 'set_active', value: false } }).expect(201);
    expect(again.body).toMatchObject({ drafted: 2 }); // merges into the same drafts
    expect(await drafts(agent, pos)).toHaveLength(2);

    await post(agent, pos, 'bulk', { item_ids: ['p1'], action: { type: 'move_category', value: 'nope' } }).expect(400);
    await post(agent, pos, 'bulk', { item_ids: [], action: { type: 'set_active', value: true } }).expect(400);
    await post(agent, pos, 'bulk', { item_ids: ['p1'], action: { type: 'price_percent', value: -95 } }).expect(400);
  });

  it('copies an item with its sizes and add-ons but not its SKU', async () => {
    const { pos, agent } = await setup();
    const res = await post(agent, pos, 'duplicate', { item_id: 'p1' }).expect(201);
    expect(res.body.draft).toMatchObject({ op: 'create', entity: 'item', label: 'Latte (copy)' });
    expect(res.body.draft.fields).toMatchObject({
      price: 120,
      category_id: 'c1',
      cost_price: 40,
      variants: [{ name: 'Large', price: 160 }],
      addon_group_ids: ['g1'],
    });
    expect(res.body.draft.fields).not.toHaveProperty('sku');
    expect(res.body.draft.fields.variants[0]).not.toHaveProperty('id');
    await post(agent, pos, 'duplicate', { item_id: 'ghost' }).expect(404);
    const named = await post(agent, pos, 'duplicate', { item_id: 'p2', name: 'Mocha XL' }).expect(201);
    expect(named.body.draft.label).toBe('Mocha XL');
  });

  it('imports rows: updates by name, creates new items and reports bad rows', async () => {
    const { pos, agent } = await setup();
    const res = await post(agent, pos, 'import', {
      rows: [
        { name: 'mocha', price: 155 }, // update (name match ignores case)
        { name: 'Latte', price: 120 }, // unchanged
        { name: 'Tea', category: 'Drinks', price: 30, available: true }, // create
        { name: 'Ghost', category: 'Nowhere', price: 1 }, // unknown category
        { name: 'No price' }, // create without a price
        { name: 'Mocha', price: 160, category: 'drinks' }, // merges with the first
      ],
    }).expect(201);
    expect(res.body).toMatchObject({ created: 1, updated: 2, unchanged: 1 });
    expect(res.body.errors).toEqual([
      expect.objectContaining({ row: 4, error: expect.stringContaining('Nowhere') }),
      expect.objectContaining({ row: 5, error: expect.stringContaining('price') }),
    ]);
    const list = await drafts(agent, pos);
    expect(list.map((c) => `${c.op}:${c.label}`).sort()).toEqual(['create:Tea', 'update:Mocha']);
    expect(list.find((c) => c.label === 'Mocha')!.fields.price).toEqual({ from: 150, to: 160 });
    await post(agent, pos, 'import', { rows: [] }).expect(400);
  });

  it('sends a big import as several commands of up to 100 changes, in order', async () => {
    const { pos, agent } = await setup();
    const rows = Array.from({ length: 150 }, (_, i) => ({ name: `Item ${i}`, price: i + 1 }));
    expect((await post(agent, pos, 'import', { rows }).expect(201)).body.created).toBe(150);
    expect((await publish(agent, pos).expect(201)).body).toEqual({ published: 150 });
    const sent = (await commandsFor(pos.storeId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(sent.map((c) => (c.payload as { changes: unknown[] }).changes.length)).toEqual([100, 50]);
  });
});

describe('undo', () => {
  it('puts an applied edit back, removes an applied creation, and refuses the rest', async () => {
    const { pos, agent } = await setup();
    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { price: 130 } }).expect(201);
    await draft(agent, pos, { op: 'create', entity: 'category', fields: { name: 'Snacks' } }).expect(201);
    await draft(agent, pos, { op: 'delete', entity: 'item', entity_id: 'p2' }).expect(201);
    await publish(agent, pos).expect(201);
    await answerAsPos(pos, (changes) => ({
      results: [
        { id: changes[0].id, status: 'applied', entity_id: 'p1' },
        { id: changes[1].id, status: 'applied', entity_id: 'c-new' },
        { id: changes[2].id, status: 'applied', entity_id: 'p2' },
      ],
    }));
    // The POS sends its menu again after applying, so the portal shows the new values.
    await sendMenu(
      pos,
      menuPayload(
        {
          categories: [
            { id: 'c1', name: 'Drinks', sort_order: 0, is_active: 1 },
            { id: 'c-new', name: 'Snacks', sort_order: 1, is_active: 1 },
          ],
          products: [{ id: 'p1', category_id: 'c1', name: 'Latte', price: 130, cost: 40, is_active: 1 }],
        },
        new Date(Date.now() + 5000),
      ),
    );
    const all = (await agent.get(base(pos.storeId)).expect(200)).body.changes as { id: string; op: string }[];
    const idOf = (op: string) => all.find((c) => c.op === op)!.id;

    const edit = await post(agent, pos, `${idOf('update')}/revert`).expect(201);
    expect(edit.body.draft).toMatchObject({ op: 'update', fields: { price: { from: 130, to: 120 } } });
    const created = await post(agent, pos, `${idOf('create')}/revert`).expect(201);
    expect(created.body.draft).toMatchObject({ op: 'delete', entity: 'category', entity_id: 'c-new' });
    expect((await post(agent, pos, `${idOf('delete')}/revert`).expect(400)).body.error).toBe('cannot_revert');

    await post(agent, pos, `${edit.body.draft.id}/revert`).expect(404); // a draft is not applied yet
    await post(agent, pos, `${randomUUID()}/revert`).expect(404);
    const stranger = await ownerOf((await registerPos(app)).storeId);
    await stranger.post(`${base(pos.storeId)}/${idOf('update')}/revert`).set(CSRF).expect(404);
  });
});

describe('schedules', () => {
  const breakfast = { days: [1, 2, 3, 4, 5], start: '07:00', end: '11:00' };

  async function setupWithSchedule() {
    const pos = await registerPos(app);
    const agent = await ownerOf(pos.storeId);
    await sendMenu(
      pos,
      menuPayload({ schedules: [{ entity: 'item', entity_id: 'p1', days: [2, 1], start: '07:00', end: '11:00' }] }),
    );
    return { pos, agent };
  }

  it('shows each item’s and category’s hours in the menu', async () => {
    const { pos, agent } = await setupWithSchedule();
    const menu = (await agent.get(`/api/owner/stores/${pos.storeId}/menu`).expect(200)).body;
    const find = (id: string) => menu.items.find((i: { id: string }) => i.id === id);
    expect(find('p1').schedule).toEqual([{ days: [2, 1], start: '07:00', end: '11:00' }]);
    expect(find('p2').schedule).toEqual([]);
    expect(menu.categories[0].schedule).toEqual([]);
  });

  it('drafts a schedule against the POS’s current hours and ignores a no-op', async () => {
    const { pos, agent } = await setupWithSchedule();
    const res = await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p1', fields: { schedule: [breakfast, { days: [6], start: '22:00', end: '02:00' }] },
    }).expect(201);
    expect(res.body.draft.fields.schedule.from).toEqual([{ days: [1, 2], start: '07:00', end: '11:00' }]);
    expect(res.body.draft.fields.schedule.to).toHaveLength(2);

    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p1', fields: { schedule: [{ days: [2, 1], start: '07:00', end: '11:00' }] },
    }).expect(201); // back to what the POS has: the draft disappears
    expect((await agent.get(base(pos.storeId)).expect(200)).body.changes).toHaveLength(0);
    await draft(agent, pos, {
      op: 'update', entity: 'item', entity_id: 'p1', fields: { schedule: [{ days: [1, 2], start: '07:00', end: '11:00' }] },
    }).expect(400); // same hours, days in another order
  });

  it('clears a schedule, sets one on a category, and refuses bad hours', async () => {
    const { pos, agent } = await setupWithSchedule();
    const clear = await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { schedule: [] } }).expect(201);
    expect(clear.body.draft.fields.schedule.to).toEqual([]);
    await draft(agent, pos, { op: 'update', entity: 'category', entity_id: 'c1', fields: { schedule: [breakfast] } }).expect(201);

    const bad = (schedule: unknown) =>
      draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p2', fields: { schedule } }).expect(400);
    await bad([{ days: [], start: '07:00', end: '11:00' }]);
    await bad([{ days: [7], start: '07:00', end: '11:00' }]);
    await bad([{ days: [1], start: '7:00', end: '11:00' }]);
    await bad([{ days: [1], start: '07:00', end: '07:00' }]);
    await bad([{ days: [1, 1], start: '07:00', end: '11:00' }]);
    await bad(Array.from({ length: 15 }, () => breakfast));
    await bad('always');
    expect((await agent.get(base(pos.storeId)).expect(200)).body.changes).toHaveLength(2);
  });

  it('carries hours into a new item, a copy and an undo', async () => {
    const { pos, agent } = await setupWithSchedule();
    const created = await draft(agent, pos, {
      op: 'create', entity: 'item', fields: { name: 'Pancakes', price: 90, schedule: [breakfast] },
    }).expect(201);
    expect(created.body.draft.fields.schedule).toEqual([breakfast]);

    const copy = await post(agent, pos, 'duplicate', { item_id: 'p1' }).expect(201);
    expect(copy.body.draft.fields.schedule).toEqual([{ days: [1, 2], start: '07:00', end: '11:00' }]);

    await draft(agent, pos, { op: 'update', entity: 'item', entity_id: 'p1', fields: { schedule: [] } }).expect(201);
    await publish(agent, pos).expect(201);
    await answerAsPos(pos, (changes) => ({ results: changes.map((c) => ({ id: c.id, status: 'applied', entity_id: 'x' })) }));
    await sendMenu(pos, menuPayload({ schedules: [] }, new Date(Date.now() + 5000)));
    const all = (await agent.get(base(pos.storeId)).expect(200)).body.changes as { id: string; op: string; label: string }[];
    const edit = all.find((c) => c.op === 'update')!;
    const undo = await post(agent, pos, `${edit.id}/revert`).expect(201);
    expect(undo.body.draft.fields.schedule.to).toEqual([{ days: [1, 2], start: '07:00', end: '11:00' }]);
  });
});
