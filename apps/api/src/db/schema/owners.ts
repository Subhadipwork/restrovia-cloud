import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { OTP_PURPOSES, OWNER_STATUSES, STORE_MEMBER_ROLES } from '@restrovia/shared';
import { bytea, citext, createdAt, oneOf, tstz, updatedAt } from './columns.js';
import { posDevices, stores } from './stores.js';

export const owners = pgTable(
  'owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().default(''),
    phoneE164: text('phone_e164').notNull(),
    email: citext('email'),
    passwordHash: text('password_hash'),
    phoneVerifiedAt: tstz('phone_verified_at'),
    emailVerifiedAt: tstz('email_verified_at'),
    status: text('status').notNull().default('active'),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('owners_status_check', oneOf(t.status, OWNER_STATUSES)),
    uniqueIndex('owners_phone_key').on(t.phoneE164),
    uniqueIndex('owners_email_key').on(t.email),
  ],
);

export const ownerSessions = pgTable(
  'owner_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: createdAt(),
    lastUsedAt: tstz('last_used_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('owner_sessions_token_key').on(t.tokenHash),
    index('owner_sessions_owner_idx').on(t.ownerId),
  ],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    purpose: text('purpose').notNull(),
    codeHash: bytea('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    ip: inet('ip'),
    expiresAt: tstz('expires_at').notNull(),
    consumedAt: tstz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('otp_codes_purpose_check', oneOf(t.purpose, OTP_PURPOSES)),
    check('otp_codes_attempts_check', sql`${t.attempts} between 0 and 5`),
    index('otp_codes_phone_created_idx').on(t.phoneE164, t.createdAt),
  ],
);

export const storeMembers = pgTable(
  'store_members',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    invitedBy: uuid('invited_by').references(() => owners.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.ownerId] }),
    check('store_members_role_check', oneOf(t.role, STORE_MEMBER_ROLES)),
    index('store_members_owner_idx').on(t.ownerId),
  ],
);

export const pairingCodes = pgTable(
  'pairing_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    codeHash: bytea('code_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    claimedBy: uuid('claimed_by').references(() => owners.id, { onDelete: 'set null' }),
    claimedAt: tstz('claimed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('pairing_codes_code_idx').on(t.codeHash)],
);

export const ownerInvites = pgTable(
  'owner_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    phoneE164: text('phone_e164').notNull(),
    role: text('role').notNull().default('manager'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    acceptedAt: tstz('accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('owner_invites_role_check', oneOf(t.role, STORE_MEMBER_ROLES)),
    uniqueIndex('owner_invites_token_key').on(t.tokenHash),
  ],
);

export const notificationPrefs = pgTable('notification_prefs', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => owners.id, { onDelete: 'cascade' }),
  dailySummaryWhatsapp: boolean('daily_summary_whatsapp').notNull().default(false),
  dailySummaryEmail: boolean('daily_summary_email').notNull().default(false),
  offlineAlert: boolean('offline_alert').notNull().default(true),
  updatedAt: updatedAt(),
});
