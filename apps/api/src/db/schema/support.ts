import {
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { DELETION_STATUSES, TICKET_STATUSES } from '@restrovia/shared';
import { createdAt, oneOf, tstz, updatedAt } from './columns.js';
import { admins } from './admin.js';
import { posDevices, stores } from './stores.js';

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    clientTicketId: text('client_ticket_id').notNull(),
    supportCode: text('support_code').notNull(),
    category: text('category'),
    message: text('message').notNull().default(''),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('open'),
    assignedAdminId: uuid('assigned_admin_id').references(() => admins.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    uniqueIndex('support_tickets_device_client_key').on(t.deviceId, t.clientTicketId),
    uniqueIndex('support_tickets_code_key').on(t.supportCode),
    check('support_tickets_status_check', oneOf(t.status, TICKET_STATUSES)),
    index('support_tickets_status_idx').on(t.status, t.createdAt),
    index('support_tickets_store_idx').on(t.storeId),
  ],
);

export const supportTicketNotes = pgTable(
  'support_ticket_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('support_ticket_notes_ticket_idx').on(t.ticketId)],
);

export const storeDiagnostics = pgTable(
  'store_diagnostics',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    reasonCode: text('reason_code'),
    severity: text('severity'),
    payload: jsonb('payload').notNull(),
    occurredAt: tstz('occurred_at'),
    receivedAt: tstz('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_diagnostics_device_event_key').on(t.deviceId, t.eventId),
    index('store_diagnostics_store_received_idx').on(t.storeId, t.receivedAt),
  ],
);

export const dataDeletionRequests = pgTable(
  'data_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    scheduledFor: tstz('scheduled_for').notNull(),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    check('data_deletion_requests_status_check', oneOf(t.status, DELETION_STATUSES)),
    index('data_deletion_requests_due_idx').on(t.status, t.scheduledFor),
  ],
);
