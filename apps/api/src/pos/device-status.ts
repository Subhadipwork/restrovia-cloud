import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';
import { posDevices, posPresence } from '../db/schema/index.js';

/** A POS counts as online when it was seen this recently (heartbeats come every 5 minutes). */
export const POS_ONLINE_MINUTES = 10;

// Heartbeats stop when the café turns Cloud Sync off; licence check-ins never do.
export const deviceLastSeen =
  sql<Date | null>`greatest(${posDevices.lastHeartbeatAt}, ${posDevices.lastLicenceAt})`.mapWith(
    posDevices.lastHeartbeatAt,
  );

export function isOnline(lastSeen: Date | string | null, now = Date.now()): boolean {
  return !!lastSeen && new Date(lastSeen).getTime() >= now - POS_ONLINE_MINUTES * 60_000;
}

/** Extends the device's current online period, or starts a new one after a gap. */
export async function recordPresence(
  db: Database,
  device: { id: string; storeId: string },
  now = new Date(),
): Promise<void> {
  const since = new Date(now.getTime() - POS_ONLINE_MINUTES * 60_000);
  const extended = await db
    .update(posPresence)
    .set({
      lastSeenAt: sql`greatest(${posPresence.lastSeenAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(posPresence.deviceId, device.id), gte(posPresence.lastSeenAt, since)))
    .returning({ id: posPresence.id });
  if (extended.length > 0) return;
  await db
    .insert(posPresence)
    .values({ storeId: device.storeId, deviceId: device.id, startedAt: now, lastSeenAt: now });
}
