import { sql } from 'drizzle-orm';
import {
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
import { DEFAULT_POS_FEATURES, DEFAULT_STORE_TIMEZONE, STORE_STATUSES } from '@restrovia/shared';
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
