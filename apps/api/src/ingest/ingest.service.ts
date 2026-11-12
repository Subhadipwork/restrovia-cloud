import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { posBackupPayloadSchema, type PosEvent } from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import {
  orderBills,
  orderItems,
  orders,
  posBackups,
  stores,
  syncEvents,
} from '../db/schema/index.js';
import type { PosDevice } from '../pos/pos-auth.guard.js';
import { businessDate } from '../sales/business-date.js';
import { mapOrderSnapshot } from './order-snapshot.js';
import { StatsService } from './stats.service.js';

export type IngestResult = {
  accepted: number;
  duplicates: number;
  stale: number;
  rejected: number;
};

const ORDER_EVENTS = new Set(['order.created', 'order.updated']);
const BACKUP_EVENTS: Record<string, 'success' | 'failed'> = {
  'backup.completed': 'success',
  'backup.failed': 'failed',
};

@Injectable()
export class IngestService {
  private readonly log = new Logger(IngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stats: StatsService,
  ) {}

  /**
   * Stores one batch in a single transaction. The POS marks the whole batch delivered on any 2xx,
   * so this must never fail because of one bad event: unusable snapshots are counted as rejected,
   * kept in sync_events for inspection, and skipped.
   */
  async ingest(device: PosDevice, events: PosEvent[]): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, duplicates: 0, stale: 0, rejected: 0 };

    await this.db.transaction(async (tx) => {
      const store = await tx.query.stores.findFirst({ where: eq(stores.id, device.storeId) });
      if (!store) throw new Error(`Store ${device.storeId} is missing for device ${device.id}`);
      const dayOf = (at: Date) => businessDate(at, store.timezone, store.businessDayStart);
      const touched = new Set<string>();

      for (const event of events) {
        const mapped =
          ORDER_EVENTS.has(event.type) && event.entity_type === 'order'
            ? mapOrderSnapshot(event.payload)
            : null;
        const inserted = await tx
          .insert(syncEvents)
          .values({
            deviceId: device.id,
            eventId: event.id,
            storeId: device.storeId,
            type: event.type,
            entityType: event.entity_type,
            entityId: event.entity_id,
            payload: mapped ? mapped.snapshot : (event.payload ?? null),
          })
          .onConflictDoNothing()
          .returning({ id: syncEvents.eventId });
        if (inserted.length === 0) {
          result.duplicates++;
          continue;
        }
        result.accepted++;
        const backupStatus = event.entity_type === 'backup' ? BACKUP_EVENTS[event.type] : undefined;
        if (backupStatus) {
          const backup = posBackupPayloadSchema.safeParse(event.payload);
          if (!backup.success) {
            result.rejected++;
            this.log.warn(`Unusable backup report in event ${event.id} from device ${device.id}`);
            continue;
          }
          await tx
            .insert(posBackups)
            .values({
              storeId: device.storeId,
              deviceId: device.id,
              eventId: event.id,
              destination: backup.data.destination,
              status: backupStatus,
              fileName: backup.data.file_name ?? null,
              sizeBytes: backup.data.size_bytes ?? null,
              error: backup.data.error ?? null,
              occurredAt: new Date(backup.data.occurred_at),
            })
            .onConflictDoNothing();
          continue;
        }
        if (!ORDER_EVENTS.has(event.type) || event.entity_type !== 'order') continue;
        if (!mapped) {
          result.rejected++;
          this.log.warn(`Unusable order snapshot in event ${event.id} from device ${device.id}`);
          continue;
        }

        const existing = await tx.query.orders.findFirst({
          where: and(eq(orders.storeId, device.storeId), eq(orders.posOrderId, mapped.posOrderId)),
        });
        if (existing && existing.posUpdatedAt > mapped.posUpdatedAt) {
          result.stale++;
          continue;
        }

        const day = dayOf(mapped.posCreatedAt);
        touched.add(day);
        if (existing) {
          touched.add(existing.businessDate);
          const oldBills = await tx
            .select({ paidAt: orderBills.paidAt })
            .from(orderBills)
            .where(eq(orderBills.orderId, existing.id));
          for (const b of oldBills) if (b.paidAt) touched.add(dayOf(b.paidAt));
        }
        for (const b of mapped.bills) if (b.paidAt) touched.add(dayOf(b.paidAt));

        const { items, bills, ...orderFields } = mapped;
        const [row] = await tx
          .insert(orders)
          .values({
            ...orderFields,
            storeId: device.storeId,
            deviceId: device.id,
            businessDate: day,
          })
          .onConflictDoUpdate({
            target: [orders.storeId, orders.posOrderId],
            set: { ...orderFields, deviceId: device.id, businessDate: day, syncedAt: new Date() },
          })
          .returning({ id: orders.id });

        await tx.delete(orderItems).where(eq(orderItems.orderId, row.id));
        await tx.delete(orderBills).where(eq(orderBills.orderId, row.id));
        if (items.length > 0) {
          await tx.insert(orderItems).values(
            items.map((i) => ({
              ...i,
              orderId: row.id,
              storeId: device.storeId,
              businessDate: day,
            })),
          );
        }
        if (bills.length > 0) {
          await tx
            .insert(orderBills)
            .values(bills.map((b) => ({ ...b, orderId: row.id, storeId: device.storeId })));
        }
      }

      for (const day of touched) await this.stats.recompute(tx, device.storeId, day);
    });

    return result;
  }
}
