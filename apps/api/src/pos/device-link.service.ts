import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { deviceLinkCodes } from '../db/schema/index.js';
import type { PosDevice } from './pos-auth.guard.js';

const CODE_TTL_MS = 15 * 60_000;
export const LINK_CODE_DIGITS = 8;

/** Codes a POS shows so its owner can move it to their store from the owner portal. */
@Injectable()
export class DeviceLinkService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /** A new code for this POS on this computer; its earlier unused codes stop working. */
  async createCode(device: PosDevice, machineIdHash: string) {
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    return this.db.transaction(async (tx) => {
      await tx
        .update(deviceLinkCodes)
        .set({ expiresAt: new Date() })
        .where(and(eq(deviceLinkCodes.deviceId, device.id), isNull(deviceLinkCodes.usedAt)));
      // Owners type only the code, so a code must be unique among the ones still open.
      for (;;) {
        const code = this.crypto.randomDigits(LINK_CODE_DIGITS);
        const taken = await tx.query.deviceLinkCodes.findFirst({
          where: and(
            eq(deviceLinkCodes.codeHash, this.codeHash(code)),
            isNull(deviceLinkCodes.usedAt),
            gt(deviceLinkCodes.expiresAt, new Date()),
          ),
        });
        if (taken) continue;
        await tx.insert(deviceLinkCodes).values({
          deviceId: device.id,
          machineIdHash,
          codeHash: this.codeHash(code),
          expiresAt,
        });
        return { code, expires_at: expiresAt.toISOString() };
      }
    });
  }

  codeHash(code: string): Buffer {
    return this.crypto.sha256(`device-link:${code}`);
  }
}
