import { and, eq, isNull, ne } from 'drizzle-orm';
import { OWNER_AUTH } from '@restrovia/shared';
import type { CryptoService } from '../crypto/crypto.service.js';
import type { Database } from '../db/database.module.js';
import { owners, ownerSecurityEvents, ownerSessions } from '../db/schema/index.js';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type OwnerRow = typeof owners.$inferSelect;
export type RequestContext = { ip: string | null; userAgent: string | null };

export type OwnerSecurityAction =
  | 'owner.created'
  | 'owner.account_setup'
  | 'owner.login'
  | 'owner.login_failed'
  | 'owner.locked'
  | 'owner.logout'
  | 'owner.email_changed'
  | 'owner.password_changed'
  | 'owner.password_reset'
  | 'owner.password_set_by_support'
  | 'owner.2fa_enabled'
  | 'owner.2fa_disabled'
  | 'owner.2fa_reset_by_support'
  | 'owner.recovery_code_used'
  | 'owner.recovery_codes_regenerated'
  | 'owner.alerts_changed'
  | 'owner.manager_invited'
  | 'owner.invite_resent'
  | 'owner.invite_cancelled'
  | 'owner.manager_removed'
  | 'owner.removed_from_store'
  | 'owner.invite_accepted'
  | 'owner.store_linked'
  | 'owner.link_failed';

export async function recordEvent(
  tx: Tx | Database,
  ownerId: string,
  action: OwnerSecurityAction,
  ctx: RequestContext,
): Promise<void> {
  await tx
    .insert(ownerSecurityEvents)
    .values({ ownerId, action, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) ?? null });
}

/**
 * `createdAt` is set here rather than by the database: `now()` is the transaction's start time,
 * which can fall before a `password_changed_at` written earlier in the same transaction.
 */
export async function createSession(
  tx: Tx,
  crypto: CryptoService,
  ownerId: string,
  ctx: RequestContext,
): Promise<string> {
  const token = crypto.randomToken(32);
  const now = new Date();
  await tx.insert(ownerSessions).values({
    ownerId,
    tokenHash: crypto.sha256(token),
    userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    ip: ctx.ip,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + OWNER_AUTH.sessionDays * 86_400_000),
  });
  return token;
}

/** Revokes every open session of the owner, except `keepSessionId` when given. */
export async function revokeSessions(
  tx: Tx | Database,
  ownerId: string,
  keepSessionId?: string,
): Promise<void> {
  await tx
    .update(ownerSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(ownerSessions.ownerId, ownerId),
        isNull(ownerSessions.revokedAt),
        keepSessionId ? ne(ownerSessions.id, keepSessionId) : undefined,
      ),
    );
}

export const isLocked = (owner: OwnerRow) =>
  owner.lockedUntil !== null && owner.lockedUntil.getTime() > Date.now();
