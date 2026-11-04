import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { ownerSessions, pairingCodes, storeMembers } from '../db/schema/index.js';
import type { PosDevice } from './pos-auth.guard.js';

const CODE_TTL_MS = 15 * 60_000;

/** Codes shown on the POS that owners enter in the owner portal to link the store. */
@Injectable()
export class PairingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /** With revoke, every owner and manager linked to the store is unlinked and older codes stop working. */
  async createCode(device: PosDevice, revoke: boolean) {
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    return this.db.transaction(async (tx) => {
      if (revoke) {
        await tx.delete(storeMembers).where(eq(storeMembers.storeId, device.storeId));
        await tx
          .update(pairingCodes)
          .set({ expiresAt: new Date() })
          .where(and(eq(pairingCodes.storeId, device.storeId), isNull(pairingCodes.claimedAt)));
      }
      // Owners type only the code, so a code must be unique among the ones still open.
      for (;;) {
        const code = this.crypto.randomDigits(6);
        const taken = await tx.query.pairingCodes.findFirst({
          where: and(
            eq(pairingCodes.codeHash, this.codeHash(code)),
            isNull(pairingCodes.claimedAt),
            gt(pairingCodes.expiresAt, new Date()),
          ),
        });
        if (taken) continue;
        await tx.insert(pairingCodes).values({
          storeId: device.storeId,
          deviceId: device.id,
          codeHash: this.codeHash(code),
          expiresAt,
        });
        return { code, expires_at: expiresAt.toISOString() };
      }
    });
  }

  codeHash(code: string): Buffer {
    return this.crypto.sha256(`pairing:${code}`);
  }

  /** Owner-portal sign-ins of people linked to this store, in the shape the POS settings page lists. */
  async listDevices(storeId: string) {
    const members = await this.db
      .select({ ownerId: storeMembers.ownerId })
      .from(storeMembers)
      .where(eq(storeMembers.storeId, storeId));
    if (members.length === 0) return [];
    const sessions = await this.db
      .select()
      .from(ownerSessions)
      .where(
        and(
          inArray(
            ownerSessions.ownerId,
            members.map((m) => m.ownerId),
          ),
          isNull(ownerSessions.revokedAt),
          gt(ownerSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(ownerSessions.lastUsedAt));
    return sessions.map((s) => ({
      id: s.id,
      platform: null,
      app_version: null,
      user_agent: s.userAgent,
      country: null,
      first_seen_at: s.createdAt.toISOString(),
      last_seen_at: s.lastUsedAt.toISOString(),
    }));
  }
}
