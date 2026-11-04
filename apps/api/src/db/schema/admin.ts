import {
  bigserial,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ADMIN_ROLES, ADMIN_STATUSES } from '@restrovia/shared';
import { bytea, citext, createdAt, oneOf, tstz } from './columns.js';

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Null until the admin finishes 2FA setup; sign-in requires it once set. */
    totpSecretEnc: bytea('totp_secret_enc'),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('admins_email_key').on(t.email),
    check('admins_role_check', oneOf(t.role, ADMIN_ROLES)),
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
