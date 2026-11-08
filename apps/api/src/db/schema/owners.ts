import {
  bigint,
  bigserial,
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
import { OWNER_EMAIL_TOKEN_PURPOSES, OWNER_STATUSES, STORE_MEMBER_ROLES } from '@restrovia/shared';
import { admins } from './admin.js';
import { bytea, citext, createdAt, oneOf, tstz, updatedAt } from './columns.js';
import { posDevices, stores } from './stores.js';

export const owners = pgTable(
  'owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().default(''),
    /** Optional contact number for alerts; sign-in is by email. */
    phoneE164: text('phone_e164'),
    email: citext('email').notNull(),
    /** Null until the owner opens the invite from Restrovia and chooses a password. */
    passwordHash: text('password_hash'),
    phoneVerifiedAt: tstz('phone_verified_at'),
    emailVerifiedAt: tstz('email_verified_at'),
    /** Null means 2FA is off. */
    totpSecretEnc: bytea('totp_secret_enc'),
    /** Last authenticator time step accepted; a code at or before it is refused (no reuse). */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    totpEnabledAt: tstz('totp_enabled_at'),
    /** Sessions created before this stop working. */
    passwordChangedAt: tstz('password_changed_at'),
    /** Set when a Restrovia admin chose the password; the portal asks for a new one at sign-in. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: smallint('failed_logins').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    status: text('status').notNull().default('active'),
    lastLoginAt: tstz('last_login_at'),
    /** Owner accounts are created by the Restrovia team from a store in the admin panel. */
    createdByAdminId: uuid('created_by_admin_id').references(() => admins.id, {
      onDelete: 'set null',
    }),
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
    email: citext('email').notNull(),
    phoneE164: text('phone_e164'),
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

/** One-time 2FA recovery codes, stored as SHA-256. */
export const ownerRecoveryCodes = pgTable(
  'owner_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    codeHash: bytea('code_hash').notNull(),
    usedAt: tstz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('owner_recovery_codes_owner_idx').on(t.ownerId)],
);

/** Links emailed to an owner. `email` is the address the link was sent to. */
export const ownerEmailTokens = pgTable(
  'owner_email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    email: citext('email').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('owner_email_tokens_purpose_check', oneOf(t.purpose, OWNER_EMAIL_TOKEN_PURPOSES)),
    uniqueIndex('owner_email_tokens_token_key').on(t.tokenHash),
    index('owner_email_tokens_owner_idx').on(t.ownerId, t.purpose, t.createdAt),
  ],
);

/** Sign-ins and security changes, listed to the owner on the security page. */
export const ownerSecurityEvents = pgTable(
  'owner_security_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('owner_security_events_owner_idx').on(t.ownerId, t.createdAt)],
);
