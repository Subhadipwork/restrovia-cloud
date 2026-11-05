import type { Database } from '../db/database.module.js';
import { adminAuditLog } from '../db/schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type AuditEntry = {
  adminId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
};

/** Call inside the same transaction as the change, so a change is never saved without its record. */
export async function writeAudit(tx: Tx | Database, entry: AuditEntry): Promise<void> {
  await tx.insert(adminAuditLog).values({
    adminId: entry.adminId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? {},
    ip: entry.ip ?? null,
  });
}
