import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CURRENT_SUBSCRIPTION_STATUSES, type PolicyKey, type PolicyMode } from '@restrovia/shared';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { plans, posDevices, storePolicyLocks, stores, subscriptions } from '../db/schema/index.js';
import { bumpPolicyRev, cleanLocks } from '../policy/store-policy.js';
import type { AdminRow } from './admin-auth.service.js';
import { writeAudit } from './audit.js';

export type NewStoreLock = {
  key: PolicyKey;
  mode: PolicyMode;
  effect: 'lock' | 'unlock';
  reason: string;
  ends_at?: string | null;
  pos_device_id?: string | null;
};

/**
 * Admin locks on a store's POS pages and settings. Every change moves the store's policy version on
 * and is audited in its transaction; the store's POS installs are then told to fetch their licence.
 */
@Injectable()
export class AdminPolicyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
  ) {}

  async storeLocks(storeId: string) {
    const [store] = await this.db
      .select({ rev: stores.policyRev })
      .from(stores)
      .where(eq(stores.id, storeId));
    if (!store) throw new NotFoundException({ error: 'store_not_found' });
    const [plan] = await this.db
      .select({ code: plans.code, name: plans.name, locks: plans.locks })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      );
    const rows = await this.db
      .select({ lock: storePolicyLocks, deviceName: posDevices.deviceName })
      .from(storePolicyLocks)
      .leftJoin(posDevices, eq(posDevices.id, storePolicyLocks.posDeviceId))
      .where(eq(storePolicyLocks.storeId, storeId))
      .orderBy(desc(storePolicyLocks.createdAt));
    return {
      policy_rev: store.rev,
      plan: plan ? { code: plan.code, name: plan.name, locks: cleanLocks(plan.locks) } : null,
      locks: rows.map(({ lock, deviceName }) => ({
        id: lock.id,
        key: lock.key,
        mode: lock.mode,
        effect: lock.effect,
        reason: lock.reason,
        ends_at: lock.endsAt,
        pos_device_id: lock.posDeviceId,
        device_name: deviceName,
        created_at: lock.createdAt,
      })),
    };
  }

  async addLock(storeId: string, input: NewStoreLock, admin: AdminRow, ip: string | null) {
    if (input.effect === 'unlock' && input.pos_device_id) {
      throw new BadRequestException({ error: 'unlock_is_store_wide' });
    }
    const endsAt = input.ends_at ? new Date(input.ends_at) : null;
    if (endsAt && endsAt <= new Date()) throw new BadRequestException({ error: 'ends_in_past' });
    const row = await this.db.transaction(async (tx) => {
      const [store] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId));
      if (!store) throw new NotFoundException({ error: 'store_not_found' });
      if (input.pos_device_id) {
        const [device] = await tx
          .select({ id: posDevices.id })
          .from(posDevices)
          .where(and(eq(posDevices.id, input.pos_device_id), eq(posDevices.storeId, storeId)));
        if (!device) throw new BadRequestException({ error: 'device_not_in_store' });
      }
      const [inserted] = await tx
        .insert(storePolicyLocks)
        .values({
          storeId,
          posDeviceId: input.pos_device_id ?? null,
          key: input.key,
          mode: input.mode,
          effect: input.effect,
          reason: input.reason,
          endsAt,
          createdByAdmin: admin.id,
        })
        .returning();
      await bumpPolicyRev(tx, [storeId]);
      await writeAudit(tx, {
        adminId: admin.id,
        action: input.effect === 'unlock' ? 'policy.unlock' : 'policy.lock',
        targetType: 'store',
        targetId: storeId,
        details: { ...input, lock_id: inserted.id },
        ip,
      });
      return inserted;
    });
    await this.refresh(storeId, admin);
    return { id: row.id };
  }

  async removeLock(
    storeId: string,
    lockId: string,
    note: string,
    admin: AdminRow,
    ip: string | null,
  ) {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(storePolicyLocks)
        .where(and(eq(storePolicyLocks.id, lockId), eq(storePolicyLocks.storeId, storeId)))
        .returning();
      if (!removed) throw new NotFoundException({ error: 'lock_not_found' });
      await bumpPolicyRev(tx, [storeId]);
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'policy.remove',
        targetType: 'store',
        targetId: storeId,
        details: {
          note,
          removed: {
            key: removed.key,
            mode: removed.mode,
            effect: removed.effect,
            reason: removed.reason,
            pos_device_id: removed.posDeviceId,
          },
        },
        ip,
      });
    });
    await this.refresh(storeId, admin);
    return { ok: true };
  }

  /** Best effort: a POS that misses this still learns at its next licence check-in. */
  async refresh(storeId: string, admin: AdminRow) {
    await this.commands.requestLicenceRefresh(storeId, admin.id).catch(() => undefined);
  }
}
