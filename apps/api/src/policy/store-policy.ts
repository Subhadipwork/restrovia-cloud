import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  isPolicyKey,
  POLICY_LOCKS,
  POLICY_MODES,
  type LicenceFeature,
  type LicencePolicy,
  type PolicyLock,
  type PolicyMode,
} from '@restrovia/shared';
import type { Database } from '../db/database.module.js';
import { plans, storePolicyLocks, stores, subscriptions } from '../db/schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type StoredLock = { key: string; mode: string; reason: string };

const ADDON_OF = new Map<string, string | null>(POLICY_LOCKS.map((l) => [l.key, l.addon]));

/** Keeps only known keys and modes, so a hand-edited plan never sends the POS garbage. */
export function cleanLocks(locks: readonly StoredLock[] | null | undefined): PolicyLock[] {
  return (locks ?? []).flatMap((l) =>
    isPolicyKey(l.key) && (POLICY_MODES as readonly string[]).includes(l.mode)
      ? [{ key: l.key, mode: l.mode as PolicyMode, reason: String(l.reason ?? '').slice(0, 500) }]
      : [],
  );
}

/**
 * The locks a POS install gets: its plan's locks, minus ones the store unlocked or whose add-on
 * it owns, plus the store's own locks and this install's locks (later ones win for a key).
 * Returns null while the store has never had a lock, so its licence stays as before.
 */
export async function policyFor(
  db: Database | Tx,
  storeId: string,
  deviceId: string,
  planLocks: readonly StoredLock[],
  features: readonly LicenceFeature[] | null,
  now = new Date(),
): Promise<LicencePolicy | null> {
  const [store] = await db
    .select({ rev: stores.policyRev })
    .from(stores)
    .where(eq(stores.id, storeId));
  const rows = await db
    .select()
    .from(storePolicyLocks)
    .where(
      and(
        eq(storePolicyLocks.storeId, storeId),
        or(isNull(storePolicyLocks.posDeviceId), eq(storePolicyLocks.posDeviceId, deviceId)),
        or(isNull(storePolicyLocks.endsAt), gt(storePolicyLocks.endsAt, now)),
      ),
    );
  const rev = store?.rev ?? 0;
  if (rev === 0 && rows.length === 0 && planLocks.length === 0) return null;

  const unlocked = new Set(rows.filter((r) => r.effect === 'unlock').map((r) => r.key));
  const owned = new Set<string>(features ?? []);
  const result = new Map<string, PolicyLock>();
  for (const lock of cleanLocks(planLocks)) {
    const addon = ADDON_OF.get(lock.key);
    if (unlocked.has(lock.key) || (addon && owned.has(addon))) continue;
    result.set(lock.key, lock);
  }
  const byScope = (device: boolean) =>
    cleanLocks(rows.filter((r) => r.effect === 'lock' && (r.posDeviceId !== null) === device));
  for (const lock of [...byScope(false), ...byScope(true)]) result.set(lock.key, lock);
  return { rev, locks: [...result.values()] };
}

/** Moves the policy version on for these stores; call in the transaction that changes locks. */
export async function bumpPolicyRev(tx: Tx | Database, storeIds: string[]): Promise<void> {
  if (storeIds.length === 0) return;
  await tx
    .update(stores)
    .set({ policyRev: sql`${stores.policyRev} + 1` })
    .where(inArray(stores.id, storeIds));
}

/** Stores whose current subscription is on this plan. */
export async function storesOnPlan(tx: Tx | Database, planId: string): Promise<string[]> {
  const rows = await tx
    .select({ storeId: subscriptions.storeId })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(eq(plans.id, planId), inArray(subscriptions.status, ['trial', 'active', 'past_due'])),
    );
  return [...new Set(rows.map((r) => r.storeId))];
}
