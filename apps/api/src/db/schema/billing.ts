import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ADDON_CATEGORIES,
  ADDON_REQUEST_STATUSES,
  ADDON_INTERVALS,
  ADDON_KINDS,
  ADDON_SCOPES,
  ADDON_STATUSES,
  ADDON_UNITS,
  CURRENT_STORE_ADDON_STATUSES,
  CURRENT_SUBSCRIPTION_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PLAN_INTERVALS,
  STORE_ADDON_SOURCES,
  STORE_ADDON_STATUSES,
  SUBSCRIPTION_STATUSES,
} from '@restrovia/shared';
import { createdAt, oneOf, tstz, updatedAt } from './columns.js';
import { admins } from './admin.js';
import { owners } from './owners.js';
import { stores } from './stores.js';

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    interval: text('interval').notNull(),
    maxDevices: integer('max_devices').notNull().default(1),
    features: jsonb('features').$type<Record<string, unknown>>().notNull().default({}),
    /** Admin locks every store on this plan gets: `[{ key, mode, reason }]` (see POLICY_LOCKS). */
    locks: jsonb('locks')
      .$type<{ key: string; mode: string; reason: string }[]>()
      .notNull()
      .default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('plans_code_key').on(t.code),
    check('plans_interval_check', oneOf(t.interval, PLAN_INTERVALS)),
    check('plans_price_check', sql`${t.price} >= 0`),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    trialEndsAt: tstz('trial_ends_at'),
    currentPeriodStart: tstz('current_period_start'),
    currentPeriodEnd: tstz('current_period_end'),
    cancelledAt: tstz('cancelled_at'),
    /** Suspended with no grace period: the POS locks at its next licence check-in. */
    graceWaived: boolean('grace_waived').notNull().default(false),
    notes: text('notes'),
    createdByAdmin: uuid('created_by_admin').references(() => admins.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('subscriptions_status_check', oneOf(t.status, SUBSCRIPTION_STATUSES)),
    uniqueIndex('subscriptions_one_current_per_store')
      .on(t.storeId)
      .where(oneOf(t.status, CURRENT_SUBSCRIPTION_STATUSES)),
    index('subscriptions_store_idx').on(t.storeId),
  ],
);

export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    method: text('method').notNull(),
    gatewayRef: text('gateway_ref'),
    status: text('status').notNull().default('paid'),
    recordedByAdmin: uuid('recorded_by_admin').references(() => admins.id, {
      onDelete: 'set null',
    }),
    paidAt: tstz('paid_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('subscription_payments_method_check', oneOf(t.method, PAYMENT_METHODS)),
    check('subscription_payments_status_check', oneOf(t.status, PAYMENT_STATUSES)),
    index('subscription_payments_subscription_idx').on(t.subscriptionId),
  ],
);

/** The marketplace catalogue. `code` is the stable key in licences and on the POS; never reused. */
export const addons = pgTable(
  'addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline').notNull().default(''),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    kind: text('kind').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    interval: text('interval').notNull().default('none'),
    unit: text('unit').notNull().default('outlet'),
    trialDays: integer('trial_days').notNull().default(0),
    requires: text('requires')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    minPosVersion: text('min_pos_version'),
    scope: text('scope').notNull().default('pos'),
    status: text('status').notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    isFeatured: boolean('is_featured').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('addons_code_key').on(t.code),
    check('addons_kind_check', oneOf(t.kind, ADDON_KINDS)),
    check('addons_category_check', oneOf(t.category, ADDON_CATEGORIES)),
    check('addons_interval_check', oneOf(t.interval, ADDON_INTERVALS)),
    check('addons_unit_check', oneOf(t.unit, ADDON_UNITS)),
    check('addons_scope_check', oneOf(t.scope, ADDON_SCOPES)),
    check('addons_status_check', oneOf(t.status, ADDON_STATUSES)),
    check('addons_price_check', sql`${t.price} >= 0`),
    check('addons_trial_days_check', sql`${t.trialDays} between 0 and 90`),
  ],
);

/**
 * Which store has which add-on until when. `price` is the price it was sold at, so later
 * catalogue changes never touch it. A null end date means it never ends (free, grandfathered).
 */
export const storeAddons = pgTable(
  'store_addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id')
      .notNull()
      .references(() => addons.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    source: text('source').notNull(),
    quantity: integer('quantity').notNull().default(1),
    price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    trialEndsAt: tstz('trial_ends_at'),
    currentPeriodStart: tstz('current_period_start'),
    currentPeriodEnd: tstz('current_period_end'),
    cancelledAt: tstz('cancelled_at'),
    revokedAt: tstz('revoked_at'),
    grantedByAdmin: uuid('granted_by_admin').references(() => admins.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    /** The end date the owners were last reminded about, so each end date is reminded once. */
    remindedFor: tstz('reminded_for'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('store_addons_status_check', oneOf(t.status, STORE_ADDON_STATUSES)),
    check('store_addons_source_check', oneOf(t.source, STORE_ADDON_SOURCES)),
    check('store_addons_quantity_check', sql`${t.quantity} between 1 and 100`),
    uniqueIndex('store_addons_one_current_per_store')
      .on(t.storeId, t.addonId)
      .where(oneOf(t.status, CURRENT_STORE_ADDON_STATUSES)),
    index('store_addons_store_idx').on(t.storeId),
  ],
);

export const addonPayments = pgTable(
  'addon_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeAddonId: uuid('store_addon_id')
      .notNull()
      .references(() => storeAddons.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    method: text('method').notNull(),
    gatewayRef: text('gateway_ref'),
    status: text('status').notNull().default('paid'),
    recordedByAdmin: uuid('recorded_by_admin').references(() => admins.id, {
      onDelete: 'set null',
    }),
    paidAt: tstz('paid_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('addon_payments_method_check', oneOf(t.method, PAYMENT_METHODS)),
    check('addon_payments_status_check', oneOf(t.status, PAYMENT_STATUSES)),
    check('addon_payments_amount_check', sql`${t.amount} >= 0`),
    index('addon_payments_store_addon_idx').on(t.storeAddonId),
  ],
);

/** A café's request to buy a paid add-on (ADDON_REQUEST_STATUSES); one pending per add-on. */
export const addonRequests = pgTable(
  'addon_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id')
      .notNull()
      .references(() => addons.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('pending'),
    requestedByOwner: uuid('requested_by_owner').references(() => owners.id, {
      onDelete: 'set null',
    }),
    resolvedAt: tstz('resolved_at'),
    resolvedByAdmin: uuid('resolved_by_admin').references(() => admins.id, {
      onDelete: 'set null',
    }),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('addon_requests_status_check', oneOf(t.status, ADDON_REQUEST_STATUSES)),
    check('addon_requests_quantity_check', sql`${t.quantity} between 1 and 100`),
    uniqueIndex('addon_requests_one_pending_per_store')
      .on(t.storeId, t.addonId)
      .where(sql`${t.status} = 'pending'`),
    index('addon_requests_status_idx').on(t.status, t.createdAt),
  ],
);
