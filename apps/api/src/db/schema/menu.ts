import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MENU_CHANGE_STATUSES, type PosMenuSnapshot } from '@restrovia/shared';
import { createdAt, oneOf, tstz } from './columns.js';
import { commands } from './commands.js';
import { posDevices, stores } from './stores.js';

/** The newest menu the store's POS sent, kept whole so the portal can show it without asking the POS. */
export const menuSnapshots = pgTable('menu_snapshots', {
  storeId: uuid('store_id')
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => posDevices.id, { onDelete: 'set null' }),
  /** The café's switches on the POS; sync off freezes the portal copy. */
  syncEnabled: boolean('sync_enabled').notNull().default(true),
  portalEditing: boolean('portal_editing').notNull().default(true),
  hash: text('hash'),
  itemCount: integer('item_count').notNull().default(0),
  data: jsonb('data').$type<PosMenuSnapshot>(),
  /** When the POS built this snapshot; an older snapshot never replaces a newer one. */
  posGeneratedAt: tstz('pos_generated_at'),
  syncedAt: tstz('synced_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

/** An edit an owner made in the portal: a draft until published, then waiting for, or answered by, the POS. */
export const menuChanges = pgTable(
  'menu_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    op: text('op').notNull(),
    /** The POS's id for the item or category; empty for a create until the POS answers. */
    entityId: text('entity_id'),
    /** What the owner sees in the list: the item or category name. */
    label: text('label').notNull(),
    /** update: `{ field: { from, to } }`; create: `{ field: value }`; delete: empty. */
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('draft'),
    requestedBy: uuid('requested_by'),
    requestedByName: text('requested_by_name').notNull().default(''),
    commandId: uuid('command_id').references(() => commands.id, { onDelete: 'set null' }),
    /** The POS's answer: an error, or the values it has when the change conflicted. */
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    publishedAt: tstz('published_at'),
    answeredAt: tstz('answered_at'),
  },
  (t) => [
    check('menu_changes_status_check', oneOf(t.status, MENU_CHANGE_STATUSES)),
    check('menu_changes_entity_check', oneOf(t.entity, ['item', 'category', 'addon_group', 'addon'])),
    check('menu_changes_op_check', oneOf(t.op, ['create', 'update', 'delete'])),
    index('menu_changes_store_status_idx').on(t.storeId, t.status, t.createdAt),
  ],
);

/**
 * A named menu for one way of selling (Dine In, Home Delivery, Home Website...). It starts as the
 * Base Menu, which is the POS menu, and only records where it differs: a price, or hidden items.
 * The POS keeps its single menu; these are for the channels Restrovia Cloud serves.
 */
export const storeMenus = pgTable(
  'store_menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    /** Stable name for the built-in menus (`dine_in`, `home_website`...); null for the owner's own. */
    slug: text('slug'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('store_menus_store_slug_idx').on(t.storeId, t.slug),
    index('store_menus_store_idx').on(t.storeId, t.sortOrder),
  ],
);

/** How one item differs on a menu: a price of its own, and whether it is hidden. */
export const storeMenuItems = pgTable(
  'store_menu_items',
  {
    menuId: uuid('menu_id')
      .notNull()
      .references(() => storeMenus.id, { onDelete: 'cascade' }),
    /** The POS's id for the item. */
    itemId: text('item_id').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }),
    hidden: boolean('hidden').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.menuId, t.itemId] })],
);

/** A size's price on a menu. */
export const storeMenuVariants = pgTable(
  'store_menu_variants',
  {
    menuId: uuid('menu_id')
      .notNull()
      .references(() => storeMenus.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.menuId, t.variantId] })],
);
