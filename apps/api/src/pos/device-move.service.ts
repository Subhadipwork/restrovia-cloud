import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { CURRENT_SUBSCRIPTION_STATUSES, TRIAL_DAYS } from '@restrovia/shared';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import {
  commands,
  machineTrials,
  orderBills,
  orderItems,
  orders,
  pairingCodes,
  plans,
  posBackups,
  posDevices,
  posPresence,
  storeDiagnostics,
  stores,
  subscriptions,
  supportTickets,
  syncEvents,
} from '../db/schema/index.js';
import { StatsService } from '../ingest/stats.service.js';
import type { Tx } from '../owner/owner-sessions.js';

export type DeviceMove = {
  deviceId: string;
  targetStoreId: string;
  /** A device of the target store to switch off; by default the one bound to the same computer. */
  retireDeviceId?: string | null;
  /** Binds the device to this computer, for a POS restored from a backup on a new computer. */
  machineIdHash?: string | null;
};

export type DeviceMoveResult = {
  device_id: string;
  store_id: string;
  retired_device_id: string | null;
  removed_store_id: string | null;
};

/**
 * Moves a POS to another store, for a reinstall or a new computer, keeping that store's
 * subscription. The POS's cloud records move with it; a store left with no POS is removed.
 * Used by admins (Move to existing store) and owners (link code).
 */
@Injectable()
export class DeviceMoveService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stats: StatsService,
    private readonly commands: CommandsService,
  ) {}

  async move(input: DeviceMove): Promise<DeviceMoveResult> {
    const result = await this.db.transaction(async (tx) => {
      const now = new Date();
      const [device] = await tx
        .select()
        .from(posDevices)
        .where(eq(posDevices.id, input.deviceId))
        .for('update');
      if (!device) throw new NotFoundException({ error: 'device_not_found' });
      if (device.revokedAt) throw new GoneException({ error: 'device_revoked' });

      const target = await tx.query.stores.findFirst({
        where: eq(stores.id, input.targetStoreId),
      });
      if (!target || target.status === 'deleted') {
        throw new NotFoundException({ error: 'store_not_found' });
      }

      const machine = input.machineIdHash ?? device.machineIdHash;
      let retireId = input.retireDeviceId ?? null;
      if (!retireId && machine) {
        const [sameComputer] = await tx
          .select({ id: posDevices.id })
          .from(posDevices)
          .where(
            and(
              eq(posDevices.storeId, target.id),
              eq(posDevices.machineIdHash, machine),
              ne(posDevices.id, device.id),
              isNull(posDevices.revokedAt),
            ),
          );
        retireId = sameComputer?.id ?? null;
      }
      if (retireId) {
        if (retireId === device.id) throw new ConflictException({ error: 'cannot_retire_itself' });
        const retired = await tx
          .update(posDevices)
          .set({ revokedAt: now })
          .where(
            and(
              eq(posDevices.id, retireId),
              eq(posDevices.storeId, target.id),
              isNull(posDevices.revokedAt),
            ),
          )
          .returning({ id: posDevices.id });
        if (retired.length === 0) throw new NotFoundException({ error: 'retire_device_not_found' });
      }

      await this.checkDeviceLimit(tx, target.id, device.id);
      if (machine) await this.capTrial(tx, target.id, machine);

      const sourceStoreId = device.storeId;
      await tx
        .update(posDevices)
        .set({ storeId: target.id, machineIdHash: machine })
        .where(eq(posDevices.id, device.id));

      let removedStoreId: string | null = null;
      if (sourceStoreId !== target.id) {
        await this.moveRecords(tx, device.id, sourceStoreId, target.id);
        const [remaining] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(posDevices)
          .where(and(eq(posDevices.storeId, sourceStoreId), isNull(posDevices.revokedAt)));
        if ((remaining?.n ?? 0) === 0) {
          await tx
            .update(stores)
            .set({ status: 'deleted', deletedAt: now, updatedAt: now })
            .where(eq(stores.id, sourceStoreId));
          removedStoreId = sourceStoreId;
        }
      }
      if (target.activation === 'pending') {
        await tx
          .update(stores)
          .set({ activation: 'active', suggestedStoreId: null, updatedAt: now })
          .where(eq(stores.id, target.id));
      }
      return {
        device_id: device.id,
        store_id: target.id,
        retired_device_id: retireId,
        removed_store_id: removedStoreId,
      };
    });
    await this.commands.requestLicenceRefresh(result.store_id);
    return result;
  }

  /** A store runs as many computers as its plan allows (one on a trial or without a plan). */
  private async checkDeviceLimit(tx: Tx, storeId: string, deviceId: string) {
    const [current] = await tx
      .select({ maxDevices: plans.maxDevices })
      .from(subscriptions)
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      );
    const allowed = current?.maxDevices ?? 1;
    const [others] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(posDevices)
      .where(
        and(
          eq(posDevices.storeId, storeId),
          ne(posDevices.id, deviceId),
          isNull(posDevices.revokedAt),
        ),
      );
    if ((others?.n ?? 0) + 1 > allowed) {
      throw new ConflictException({ error: 'device_limit', max_devices: allowed });
    }
  }

  /**
   * A computer's free trial lasts TRIAL_DAYS from its first check-in, wherever it runs, so moving
   * an older computer into a newer trial store never extends its trial.
   */
  private async capTrial(tx: Tx, storeId: string, machineIdHash: string) {
    const known = await tx.query.machineTrials.findFirst({
      where: eq(machineTrials.machineIdHash, machineIdHash),
    });
    if (!known) return;
    const cap = new Date(known.firstSeenAt.getTime() + TRIAL_DAYS * 86_400_000);
    await tx
      .update(subscriptions)
      .set({
        trialEndsAt: cap,
        notes: sql`concat_ws(E'\n', nullif(${subscriptions.notes}, ''), ${'Trial capped: a computer that joined had its own trial earlier.'}::text)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.storeId, storeId),
          eq(subscriptions.status, 'trial'),
          sql`${subscriptions.trialEndsAt} > ${cap.toISOString()}::timestamptz`,
        ),
      );
  }

  private async moveRecords(tx: Tx, deviceId: string, from: string, to: string): Promise<void> {
    const moved = await tx
      .update(orders)
      .set({ storeId: to })
      .where(and(eq(orders.storeId, from), eq(orders.deviceId, deviceId)))
      .returning({ id: orders.id, day: orders.businessDate });
    const orderIds = moved.map((o) => o.id);
    if (orderIds.length > 0) {
      await tx.update(orderItems).set({ storeId: to }).where(inArray(orderItems.orderId, orderIds));
      await tx.update(orderBills).set({ storeId: to }).where(inArray(orderBills.orderId, orderIds));
    }
    for (const table of [syncEvents, posPresence, posBackups, storeDiagnostics, supportTickets]) {
      await tx
        .update(table)
        .set({ storeId: to })
        .where(and(eq(table.storeId, from), eq(table.deviceId, deviceId)));
    }
    await tx
      .delete(commands)
      .where(and(eq(commands.deviceId, deviceId), inArray(commands.status, ['queued', 'sent'])));
    await tx
      .update(pairingCodes)
      .set({ expiresAt: new Date() })
      .where(and(eq(pairingCodes.deviceId, deviceId), isNull(pairingCodes.claimedAt)));

    const days = new Set(moved.map((o) => o.day));
    for (const day of days) {
      await this.stats.recompute(tx, from, day);
      await this.stats.recompute(tx, to, day);
    }
  }
}
