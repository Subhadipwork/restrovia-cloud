import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  BACKUP_DESTINATIONS,
  BACKUP_STATUSES,
  DEFAULT_POS_FEATURES,
  DEFAULT_STORE_TIMEZONE,
  STORE_STATUSES,
} from '@restrovia/shared';
import { admins } from './admin.js';
import { bytea, citext, createdAt, moneyZero, oneOf, tstz, updatedAt } from './columns.js';

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().default(''),
    contactName: text('contact_name'),
    email: citext('email'),
    phone: text('phone'),
    country: char('country', { length: 2 }),
    currency: char('currency', { length: 3 }),
    timezone: text('timezone').notNull().default(DEFAULT_STORE_TIMEZONE),
    businessDayStart: time('business_day_start').notNull().default('00:00'),
    address: text('address'),
    storeType: text('store_type').notNull().default('cafe'),
    status: text('status').notNull().default('active'),
    emailProductUpdates: boolean('email_product_updates').notNull().default(false),
    emailMarketing: boolean('email_marketing').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('stores_status_check', oneOf(t.status, STORE_STATUSES)),
    index('stores_status_idx').on(t.status),
    index('stores_name_lower_idx').on(sql`lower(${t.name})`),
  ],
);

export const posDevices = pgTable(
  'pos_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    posHash: text('pos_hash').notNull(),
    apiKeyLookup: bytea('api_key_lookup').notNull(),
    apiKeyEnc: bytea('api_key_enc').notNull(),
    deviceSecretHash: text('device_secret_hash').notNull(),
    deviceName: text('device_name'),
    platform: text('platform'),
    arch: text('arch'),
    appVersion: text('app_version'),
    runMode: text('run_mode'),
    installSource: text('install_source'),
    lastHeartbeatAt: tstz('last_heartbeat_at'),
    lastIp: inet('last_ip'),
    activeOrders: integer('active_orders').notNull().default(0),
    todayBills: integer('today_bills').notNull().default(0),
    todaySales: moneyZero('today_sales'),
    features: jsonb('features')
      .$type<Record<string, boolean>>()
      .notNull()
      .default({ ...DEFAULT_POS_FEATURES }),
    diagnosticsConsent: boolean('diagnostics_consent').notNull().default(false),
    /** Hash of the computer's hardware ID, set at the first licence check-in. Null until then. */
    machineIdHash: text('machine_id_hash'),
    lastLicenceAt: tstz('last_licence_at'),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_devices_pos_hash_key').on(t.posHash),
    uniqueIndex('pos_devices_api_key_lookup_key').on(t.apiKeyLookup),
    index('pos_devices_store_idx').on(t.storeId),
    index('pos_devices_heartbeat_idx').on(t.lastHeartbeatAt),
  ],
);

/**
 * Each time an admin blocked the store's cloud access (stores.status `suspended`), with the reason
 * its owners and POS are shown. The open block has no `lifted_at`.
 */
export const storeBlocks = pgTable(
  'store_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    blockedAt: tstz('blocked_at').notNull().defaultNow(),
    blockedByAdmin: uuid('blocked_by_admin').references(() => admins.id, { onDelete: 'set null' }),
    liftedAt: tstz('lifted_at'),
    liftedByAdmin: uuid('lifted_by_admin').references(() => admins.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('store_blocks_one_open_key')
      .on(t.storeId)
      .where(sql`${t.liftedAt} is null`),
    index('store_blocks_store_idx').on(t.storeId, t.blockedAt),
  ],
);

/** One unbroken online period of a device: heartbeats or licence check-ins without a long gap. */
export const posPresence = pgTable(
  'pos_presence',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    startedAt: tstz('started_at').notNull(),
    lastSeenAt: tstz('last_seen_at').notNull(),
  },
  (t) => [
    index('pos_presence_device_seen_idx').on(t.deviceId, t.lastSeenAt),
    index('pos_presence_store_seen_idx').on(t.storeId, t.lastSeenAt),
  ],
);

/** Backups the POS reports making, locally or to Google Drive. */
export const posBackups = pgTable(
  'pos_backups',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    destination: text('destination').notNull(),
    status: text('status').notNull(),
    fileName: text('file_name'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    error: text('error'),
    occurredAt: tstz('occurred_at').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
  },
  (t) => [
    check('pos_backups_destination_check', oneOf(t.destination, BACKUP_DESTINATIONS)),
    check('pos_backups_status_check', oneOf(t.status, BACKUP_STATUSES)),
    uniqueIndex('pos_backups_device_event_key').on(t.deviceId, t.eventId),
    index('pos_backups_store_occurred_idx').on(t.storeId, t.occurredAt),
  ],
);

export const requestNonces = pgTable(
  'request_nonces',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    nonce: uuid('nonce').notNull(),
    seenAt: tstz('seen_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.nonce] }),
    index('request_nonces_seen_idx').on(t.seenAt),
  ],
);
