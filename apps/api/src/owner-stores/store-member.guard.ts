import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { StoreMemberRole } from '@restrovia/shared';
import { currentBlock } from '../common/store-block.js';
import { DB, type Database } from '../db/database.module.js';
import { storeMembers, stores } from '../db/schema/index.js';
import type { OwnerRequest } from '../owner/owner.guard.js';

export type StoreRow = typeof stores.$inferSelect;
export type StoreRequest = OwnerRequest & { store?: StoreRow; storeRole?: StoreMemberRole };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NotFoundException({ error: 'store_not_found' });

/**
 * Runs after OwnerGuard on routes with `:storeId`: the owner must be linked to the store. Any other
 * store answers 404, as if it didn't exist, so store ids can't be probed. A store Restrovia blocked
 * answers 403 `store_blocked` with the reason.
 */
@Injectable()
export class StoreMemberGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StoreRequest>();
    const storeId = String(req.params.storeId ?? '');
    if (!req.owner || !UUID.test(storeId)) throw notFound();
    const [row] = await this.db
      .select({ store: stores, role: storeMembers.role })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(
        and(
          eq(storeMembers.storeId, storeId),
          eq(storeMembers.ownerId, req.owner.id),
          ne(stores.status, 'deleted'),
        ),
      );
    if (!row) throw notFound();
    if (row.store.status === 'suspended') {
      const block = await currentBlock(this.db, storeId);
      throw new ForbiddenException({ error: 'store_blocked', reason: block?.reason ?? '' });
    }
    req.store = row.store;
    req.storeRole = row.role as StoreMemberRole;
    return true;
  }
}

/** Runs after StoreMemberGuard: only the café's owners, not its managers. */
@Injectable()
export class StoreOwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<StoreRequest>();
    if (req.storeRole !== 'owner') throw new ForbiddenException({ error: 'owner_only' });
    return true;
  }
}

export const CurrentStoreRole = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StoreMemberRole =>
    ctx.switchToHttp().getRequest<StoreRequest>().storeRole!,
);

export const CurrentStore = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StoreRow =>
    ctx.switchToHttp().getRequest<StoreRequest>().store!,
);
