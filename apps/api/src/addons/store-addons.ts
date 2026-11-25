import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Marks the store's ended rows for this add-on as expired, then returns the row still current, if
 * any. Call inside the transaction that may add the add-on, so the one-current-row slot is free.
 */
export async function currentStoreAddon(tx: Tx, storeId: string, addonId: string, now: Date) {
  const rows = await tx
    .select()
    .from(storeAddons)
    .where(
      and(
        eq(storeAddons.storeId, storeId),
        eq(storeAddons.addonId, addonId),
        inArray(storeAddons.status, [...CURRENT_STORE_ADDON_STATUSES]),
      ),
    )
    .for('update');
  const ended = rows.filter((r) => !storeAddonInUse(r, now)).map((r) => r.id);
  if (ended.length) {
    await tx
      .update(storeAddons)
      .set({ status: 'expired', updatedAt: now })
      .where(inArray(storeAddons.id, ended));
  }
  return rows.find((r) => !ended.includes(r.id)) ?? null;
}

/** Whether the store has ever had a free trial of this add-on. */
export async function trialUsed(tx: Tx, storeId: string, addonId: string): Promise<boolean> {
  const row = await tx.query.storeAddons.findFirst({
    where: and(
      eq(storeAddons.storeId, storeId),
      eq(storeAddons.addonId, addonId),
      isNotNull(storeAddons.trialEndsAt),
    ),
    columns: { id: true },
  });
  return !!row;
}
