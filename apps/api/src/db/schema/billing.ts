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
  CURRENT_SUBSCRIPTION_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PLAN_INTERVALS,
  SUBSCRIPTION_STATUSES,
} from '@restrovia/shared';
import { createdAt, oneOf, tstz, updatedAt } from './columns.js';
import { admins } from './admin.js';
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
