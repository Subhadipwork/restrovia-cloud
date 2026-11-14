import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  posBackupPayloadSchema,
  posMenuSnapshotSchema,
  posMenuSyncStateSchema,
  type PosEvent,
} from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import {
  menuSnapshots,
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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type IngestResult = {
  accepted: number;
  duplicates: number;
  stale: number;
  rejected: number;
};

const ORDER_EVENTS = new Set(['order.created', 'order.updated']);
const MENU_EVENTS = new Set(['menu.snapshot', 'menu.sync_state']);
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
            // A menu snapshot is kept in menu_snapshots; copying it here would only fill the table.
            payload: mapped
              ? mapped.snapshot
              : event.entity_type === 'menu'
                ? null
                : (event.payload ?? null),
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
        if (event.entity_type === 'menu' && MENU_EVENTS.has(event.type)) {
          if (!(await this.applyMenuEvent(tx, device, event))) {
            result.rejected++;
            this.log.warn(`Unusable menu event ${event.id} from device ${device.id}`);
          }
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

  /** Keeps the store's newest menu, or its sync switches. False when the payload is unusable. */
  private async applyMenuEvent(tx: Tx, device: PosDevice, event: PosEvent): Promise<boolean> {
    if (event.type === 'menu.sync_state') {
      const state = posMenuSyncStateSchema.safeParse(event.payload);
      if (!state.success) return false;
      await tx
        .insert(menuSnapshots)
        .values({
          storeId: device.storeId,
          deviceId: device.id,
          syncEnabled: state.data.sync_enabled,
          portalEditing: state.data.portal_editing,
        })
        .onConflictDoUpdate({
          target: menuSnapshots.storeId,
          set: {
            deviceId: device.id,
            syncEnabled: state.data.sync_enabled,
            portalEditing: state.data.portal_editing,
            syncedAt: new Date(),
          },
        });
      return true;
    }

    const snapshot = posMenuSnapshotSchema.safeParse(event.payload);
    if (!snapshot.success) return false;
    const generatedAt = new Date(snapshot.data.generated_at);
    const existing = await tx.query.menuSnapshots.findFirst({
      where: eq(menuSnapshots.storeId, device.storeId),
    });
    if (existing?.posGeneratedAt && existing.posGeneratedAt > generatedAt) return true;
    const values = {
      deviceId: device.id,
      syncEnabled: snapshot.data.sync_enabled,
      portalEditing: snapshot.data.portal_editing,
      hash: snapshot.data.hash,
      itemCount: snapshot.data.products.length,
      data: snapshot.data,
      posGeneratedAt: generatedAt,
      syncedAt: new Date(),
    };
    await tx
      .insert(menuSnapshots)
      .values({ storeId: device.storeId, ...values })
      .onConflictDoUpdate({ target: menuSnapshots.storeId, set: values });
    return true;
  }
}
