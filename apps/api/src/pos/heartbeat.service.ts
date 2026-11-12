import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PosBusiness, PosHeartbeatBody } from '@restrovia/shared';
import { money } from '../common/pos-values.js';
import { DB, type Database } from '../db/database.module.js';
import { posDevices, stores } from '../db/schema/index.js';
import { StatsService } from '../ingest/stats.service.js';
import { recordPresence } from './device-status.js';
import { LicenceService } from './licence.service.js';
import type { PosDevice } from './pos-auth.guard.js';
import { dayStartFrom, storeDetailsFrom } from './store-details.js';

/** How many days of daily totals are rebuilt when the timezone or business day start changes. */
const REBUILD_DAYS = 35;

/** A POS heartbeat, sent over HTTP (POST /api/pos/heartbeat) or as a relay frame. */
@Injectable()
export class HeartbeatService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly licence: LicenceService,
    private readonly stats: StatsService,
  ) {}

  async record(device: PosDevice, body: PosHeartbeatBody, ip: string | null) {
    const now = new Date();
    await this.db
      .update(posDevices)
      .set({
        lastHeartbeatAt: now,
        lastIp: ip,
        appVersion: body.app_version || device.appVersion,
        deviceName: body.device_name || device.deviceName,
        activeOrders: body.active_orders,
        todayBills: body.today_bills,
        todaySales: money(body.today_sales),
      })
      .where(eq(posDevices.id, device.id));
    await recordPresence(this.db, device, now);
    if (body.business) await this.updateStore(device.storeId, body.business);
    const [features, notice] = await Promise.all([
      this.licence.featuresFor(device.storeId),
      this.licence.storeNotice(device.storeId),
    ]);
    return { ok: true, features, store_notice: notice };
  }

  /** Copies the café's details from POS Settings to the store, writing only when they differ. */
  private async updateStore(storeId: string, business: PosBusiness) {
    const details: Partial<ReturnType<typeof storeDetailsFrom>> = storeDetailsFrom(business);
    // The POS withholds an unconfirmed country and an unsupported currency; keep the stored ones.
    if (!details.country) delete details.country;
    if (!details.currency) delete details.currency;
    const dayStart = dayStartFrom(business.business_day_start);
    await this.db.transaction(async (tx) => {
      const [store] = await tx.select().from(stores).where(eq(stores.id, storeId)).for('update');
      if (!store) return;
      const changed = (Object.keys(details) as (keyof typeof details)[]).filter(
        (key) => store[key] !== details[key],
      );
      const dayStartChanged = dayStart !== null && store.businessDayStart.slice(0, 5) !== dayStart;
      if (changed.length === 0 && !dayStartChanged) return;

      await tx
        .update(stores)
        .set({
          ...details,
          ...(dayStartChanged ? { businessDayStart: dayStart } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stores.id, storeId));
      if (changed.includes('timezone') || dayStartChanged) {
        const since = new Date(Date.now() - REBUILD_DAYS * 86_400_000);
        await this.stats.rebuildSince(tx, storeId, since);
      }
    });
  }
}
