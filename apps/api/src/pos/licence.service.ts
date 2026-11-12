import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { CURRENT_SUBSCRIPTION_STATUSES, DEFAULT_POS_FEATURES } from '@restrovia/shared';
import { DB, type Database } from '../db/database.module.js';
import { currentBlock } from '../common/store-block.js';
import { subscriptions } from '../db/schema/index.js';

export type PosFeatures = { [K in keyof typeof DEFAULT_POS_FEATURES]: boolean };

/** Sent with every heartbeat so the POS can show why Restrovia blocked the store; null otherwise. */
export type StoreNotice = { status: 'blocked'; reason: string; since: string };

/**
 * Features returned in the heartbeat. Without a current licence, or while Restrovia has blocked the
 * store, orders and reports stop going to the cloud, but sync itself stays on: the POS stops sending heartbeats when sync is off, and then
 * it could never learn that the licence was renewed. Billing in the café is never affected.
 */
@Injectable()
export class LicenceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async featuresFor(storeId: string, now = new Date()): Promise<PosFeatures> {
    const current = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.storeId, storeId),
        inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
      ),
    });
    const blocked = !!(await this.storeNotice(storeId));
    const active =
      !blocked &&
      !!current &&
      (current.status !== 'trial' || !current.trialEndsAt || current.trialEndsAt > now) &&
      (current.status === 'trial' || !current.currentPeriodEnd || current.currentPeriodEnd > now);
    return {
      cloud_sync_enabled: true,
      cloud_orders_enabled: active,
      cloud_reports_enabled: active,
    };
  }

  async storeNotice(storeId: string): Promise<StoreNotice | null> {
    const block = await currentBlock(this.db, storeId);
    return block && { status: 'blocked', reason: block.reason, since: block.since.toISOString() };
  }
}
