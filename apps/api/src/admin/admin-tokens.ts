import { UnauthorizedException } from '@nestjs/common';
import { and, count, eq, gt, isNull, ne } from 'drizzle-orm';
import { ADMIN_AUTH, type AdminTokenPurpose } from '@restrovia/shared';
import type { CryptoService } from '../crypto/crypto.service.js';
import type { Database } from '../db/database.module.js';
import { admins, adminSessions, adminTokens } from '../db/schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const invalidLink = () => new UnauthorizedException({ error: 'invalid_link' });

const TTL_MS: Record<AdminTokenPurpose, number> = {
  invite: ADMIN_AUTH.inviteHours * 3_600_000,
  password_reset: ADMIN_AUTH.resetMinutes * 60_000,
};
const LINK_PATH: Record<AdminTokenPurpose, string> = {
  invite: '/accept-invite',
  password_reset: '/reset-password',
};

/** Makes a single-use link; earlier unused links of the same kind stop working. */
export async function issueLink(
  tx: Tx,
  crypto: CryptoService,
  appUrl: string,
  adminId: string,
  purpose: AdminTokenPurpose,
  createdBy: string | null,
): Promise<string> {
  const now = new Date();
  await tx
    .update(adminTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(adminTokens.adminId, adminId),
        eq(adminTokens.purpose, purpose),
        isNull(adminTokens.usedAt),
      ),
    );
  const token = crypto.randomToken(32);
  await tx.insert(adminTokens).values({
    adminId,
    purpose,
    tokenHash: crypto.sha256(token),
    expiresAt: new Date(now.getTime() + TTL_MS[purpose]),
    createdByAdmin: createdBy,
  });
  return `${appUrl}${LINK_PATH[purpose]}?token=${encodeURIComponent(token)}`;
}

/** How many links of this kind went out for this admin in the last hour. */
export async function linksSentLastHour(
  db: Database | Tx,
  adminId: string,
  purpose: AdminTokenPurpose,
) {
  const [row] = await db
    .select({ n: count() })
    .from(adminTokens)
    .where(
      and(
        eq(adminTokens.adminId, adminId),
        eq(adminTokens.purpose, purpose),
        gt(adminTokens.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  return row?.n ?? 0;
}

/** The admin a still-valid link belongs to; refused once used, expired or superseded. */
export async function linkOwner(
  db: Database | Tx,
  crypto: CryptoService,
  token: string,
  purpose: AdminTokenPurpose,
) {
  const [row] = await db
    .select({ token: adminTokens, admin: admins })
    .from(adminTokens)
    .innerJoin(admins, eq(admins.id, adminTokens.adminId))
    .where(
      and(
        eq(adminTokens.tokenHash, crypto.sha256(token)),
        eq(adminTokens.purpose, purpose),
        isNull(adminTokens.usedAt),
        gt(adminTokens.expiresAt, new Date()),
      ),
    );
  if (!row) throw invalidLink();
  return row;
}

/** Marks the link used; a second use (or a race) is refused. */
export async function useLink(
  tx: Tx,
  crypto: CryptoService,
  token: string,
  purpose: AdminTokenPurpose,
) {
  const [row] = await tx
    .update(adminTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(adminTokens.tokenHash, crypto.sha256(token)),
        eq(adminTokens.purpose, purpose),
        isNull(adminTokens.usedAt),
        gt(adminTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw invalidLink();
  return row;
}

/** Signs an admin out everywhere, optionally keeping one session (the one making the change). */
export async function endSessions(tx: Tx | Database, adminId: string, keep?: string) {
  const rows = await tx
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(adminSessions.adminId, adminId),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date()),
        keep ? ne(adminSessions.id, keep) : undefined,
      ),
    )
    .returning({ id: adminSessions.id });
  return rows.length;
}
