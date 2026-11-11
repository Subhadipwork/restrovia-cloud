import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, count, eq, gt, isNull, ne } from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import { ownerSecurityEvents, pairingCodes, storeMembers, stores } from '../db/schema/index.js';
import { recordEvent, type OwnerRow, type RequestContext } from '../owner/owner-sessions.js';
import { PairingService } from '../pos/pairing.service.js';

/** Wrong codes allowed in the window before linking pauses for that person. */
export const LINK_FAILURES = 5;
export const LINK_WINDOW_MS = 15 * 60_000;

const wrongCode = () => new BadRequestException({ error: 'invalid_pairing_code' });

/**
 * Links a café to the signed-in person as an owner, with the 6-digit code its POS shows. Only
 * someone at the café's POS with access to Settings can see the code.
 */
@Injectable()
export class StoreLinkService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pairing: PairingService,
  ) {}

  async link(me: OwnerRow, code: string, ctx: RequestContext) {
    const [recent] = await this.db
      .select({ n: count() })
      .from(ownerSecurityEvents)
      .where(
        and(
          eq(ownerSecurityEvents.ownerId, me.id),
          eq(ownerSecurityEvents.action, 'owner.link_failed'),
          gt(ownerSecurityEvents.createdAt, new Date(Date.now() - LINK_WINDOW_MS)),
        ),
      );
    if ((recent?.n ?? 0) >= LINK_FAILURES) {
      throw new HttpException({ error: 'too_many_codes' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const [found] = await tx
          .select({ id: pairingCodes.id, storeId: pairingCodes.storeId, name: stores.name })
          .from(pairingCodes)
          .innerJoin(stores, eq(stores.id, pairingCodes.storeId))
          .where(
            and(
              eq(pairingCodes.codeHash, this.pairing.codeHash(code)),
              isNull(pairingCodes.claimedAt),
              gt(pairingCodes.expiresAt, now),
              ne(stores.status, 'deleted'),
            ),
          )
          .for('update', { of: pairingCodes });
        if (!found) throw wrongCode();

        const [member] = await tx
          .select({ role: storeMembers.role })
          .from(storeMembers)
          .where(and(eq(storeMembers.storeId, found.storeId), eq(storeMembers.ownerId, me.id)));
        // Leaves the code unused, so someone else at the café can still use it.
        if (member?.role === 'owner') throw new ConflictException({ error: 'already_linked' });

        const claimed = await tx
          .update(pairingCodes)
          .set({ claimedBy: me.id, claimedAt: now })
          .where(and(eq(pairingCodes.id, found.id), isNull(pairingCodes.claimedAt)))
          .returning({ id: pairingCodes.id });
        if (claimed.length === 0) throw wrongCode();

        if (member) {
          await tx
            .update(storeMembers)
            .set({ role: 'owner' })
            .where(and(eq(storeMembers.storeId, found.storeId), eq(storeMembers.ownerId, me.id)));
        } else {
          await tx
            .insert(storeMembers)
            .values({ storeId: found.storeId, ownerId: me.id, role: 'owner' });
        }
        await recordEvent(tx, me.id, 'owner.store_linked', ctx);
        return { store_id: found.storeId, name: found.name, was_manager: !!member };
      });
    } catch (err) {
      if (err instanceof BadRequestException)
        await recordEvent(this.db, me.id, 'owner.link_failed', ctx);
      throw err;
    }
  }
}
