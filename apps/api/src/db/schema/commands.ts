import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { COMMAND_STATUSES } from '@restrovia/shared';
import { createdAt, oneOf, tstz } from './columns.js';
import { posDevices, stores } from './stores.js';

export const commands = pgTable(
  'commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text('correlation_id'),
    status: text('status').notNull().default('queued'),
    /** Owner or admin id; not a foreign key because it can point at either table. */
    requestedBy: uuid('requested_by'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
    sentAt: tstz('sent_at'),
    completedAt: tstz('completed_at'),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    check('commands_status_check', oneOf(t.status, COMMAND_STATUSES)),
    index('commands_device_status_idx').on(t.deviceId, t.status, t.createdAt),
  ],
);
