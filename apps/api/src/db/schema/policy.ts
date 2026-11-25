import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { POLICY_KEYS, POLICY_MODES } from '@restrovia/shared';
import { admins } from './admin.js';
import { createdAt, oneOf, tstz } from './columns.js';
import { posDevices, stores } from './stores.js';

/**
 * Locks an admin set on one store (`pos_device_id` null) or one POS install. `unlock` lifts a lock
 * the store's plan sets. Removing a row removes the lock; the audit log keeps the history.
 */
export const storePolicyLocks = pgTable(
  'store_policy_locks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    posDeviceId: uuid('pos_device_id').references(() => posDevices.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    mode: text('mode').notNull().default('read_only'),
    effect: text('effect').notNull().default('lock'),
    reason: text('reason').notNull(),
    endsAt: tstz('ends_at'),
    createdByAdmin: uuid('created_by_admin').references(() => admins.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('store_policy_locks_key_check', oneOf(t.key, POLICY_KEYS)),
    check('store_policy_locks_mode_check', oneOf(t.mode, POLICY_MODES)),
    check('store_policy_locks_effect_check', oneOf(t.effect, ['lock', 'unlock'])),
    check(
      'store_policy_locks_unlock_store_check',
      sql`${t.effect} = 'lock' or ${t.posDeviceId} is null`,
    ),
    index('store_policy_locks_store_idx').on(t.storeId),
  ],
);
