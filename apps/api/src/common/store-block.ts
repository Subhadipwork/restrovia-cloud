import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';
import { storeBlocks, stores } from '../db/schema/index.js';

/** Why and since when Restrovia blocked a store's cloud access. */
export type StoreBlock = { reason: string; since: Date };

/** The store's open block, or null when its cloud access is not blocked. */
export async function currentBlock(db: Database, storeId: string): Promise<StoreBlock | null> {
  const [row] = await db
    .select({ status: stores.status, reason: storeBlocks.reason, since: storeBlocks.blockedAt })
    .from(stores)
    .leftJoin(storeBlocks, and(eq(storeBlocks.storeId, stores.id), isNull(storeBlocks.liftedAt)))
    .where(eq(stores.id, storeId))
    .limit(1);
  if (row?.status !== 'suspended') return null;
  return { reason: row.reason ?? '', since: row.since ?? new Date(0) };
}
