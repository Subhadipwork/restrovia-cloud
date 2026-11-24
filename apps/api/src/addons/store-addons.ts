import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  CURRENT_STORE_ADDON_STATUSES,
  LICENCE_FEATURES,
  type LicenceFeature,
} from '@restrovia/shared';
import type { Database } from '../db/database.module.js';
import { addons, storeAddons } from '../db/schema/index.js';

type StoreAddonEnd = { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null };

/** When a store's add-on stops: the trial end for a trial, else the period end; null never ends. */
export function storeAddonEndsAt(row: StoreAddonEnd): Date | null {
  return row.status === 'trial' ? row.trialEndsAt : row.currentPeriodEnd;
}

/** Whether the add-on is in use now: a current status and an end date still ahead (or none). */
export function storeAddonInUse(row: StoreAddonEnd, now: Date): boolean {
  if (!(CURRENT_STORE_ADDON_STATUSES as readonly string[]).includes(row.status)) return false;
  const end = storeAddonEndsAt(row);
  return end === null || end > now;
}

const endsAtSql = sql`case when ${storeAddons.status} = 'trial' then ${storeAddons.trialEndsAt} else ${storeAddons.currentPeriodEnd} end`;

/** Licence feature codes each store has as add-ons in use now, by store id. */
export async function licenceAddonsFor(
  db: Database,
  storeIds: string[],
  now: Date,
): Promise<Map<string, LicenceFeature[]>> {
  const result = new Map<string, LicenceFeature[]>();
  if (storeIds.length === 0) return result;
  const rows = await db
    .select({ storeId: storeAddons.storeId, code: addons.code })
    .from(storeAddons)
    .innerJoin(addons, eq(addons.id, storeAddons.addonId))
    .where(
      and(
        inArray(storeAddons.storeId, storeIds),
        inArray(storeAddons.status, [...CURRENT_STORE_ADDON_STATUSES]),
        inArray(addons.code, [...LICENCE_FEATURES]),
        or(isNull(endsAtSql), gt(endsAtSql, now)),
      ),
    );
  for (const { storeId, code } of rows) {
    const list = result.get(storeId) ?? [];
    list.push(code as LicenceFeature);
    result.set(storeId, list);
  }
  return result;
}
