import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ADMIN_STATUSES } from '@restrovia/shared';
import { bytea, citext, createdAt, oneOf, tstz, updatedAt } from './columns.js';

/** A named set of permissions. System roles have fixed ids and keys (SYSTEM_ROLE_IDS). */
export const adminRoles = pgTable(
  'admin_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Permission keys from the shared catalog; `*` means every permission. */
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('admin_roles_key_key').on(t.key),
    uniqueIndex('admin_roles_name_key').on(sql`lower(${t.name})`),
    check('admin_roles_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$'`),
  ],
);

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Null until the admin finishes 2FA setup; sign-in requires it once set. */
    totpSecretEnc: bytea('totp_secret_enc'),
    /** Last authenticator time step accepted; a code at or before it is refused (no reuse). */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adminRoles.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('admins_email_key').on(t.email),
    index('admins_role_idx').on(t.roleId),
    check('admins_status_check', oneOf(t.status, ADMIN_STATUSES)),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    ip: inet('ip'),
    createdAt: createdAt(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('admin_sessions_token_key').on(t.tokenHash),
    index('admin_sessions_admin_idx').on(t.adminId),
  ],
);

/** Append-only: a trigger in the migrations rejects UPDATE and DELETE. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_audit_log_admin_idx').on(t.adminId, t.createdAt),
    index('admin_audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);
