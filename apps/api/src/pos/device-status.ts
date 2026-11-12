import { sql } from 'drizzle-orm';
import { posDevices } from '../db/schema/index.js';

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
