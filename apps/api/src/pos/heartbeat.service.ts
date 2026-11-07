import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PosHeartbeatBody } from '@restrovia/shared';
import { money } from '../common/pos-values.js';
import { DB, type Database } from '../db/database.module.js';
import { posDevices } from '../db/schema/index.js';
import { LicenceService } from './licence.service.js';
import type { PosDevice } from './pos-auth.guard.js';

/** A POS heartbeat, sent over HTTP (POST /api/pos/heartbeat) or as a relay frame. */
@Injectable()
export class HeartbeatService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly licence: LicenceService,
  ) {}

  async record(device: PosDevice, body: PosHeartbeatBody, ip: string | null) {
    await this.db
      .update(posDevices)
      .set({
        lastHeartbeatAt: new Date(),
        lastIp: ip,
        appVersion: body.app_version || device.appVersion,
        deviceName: body.device_name || device.deviceName,
        activeOrders: body.active_orders,
        todayBills: body.today_bills,
        todaySales: money(body.today_sales),
      })
      .where(eq(posDevices.id, device.id));
    return { ok: true, features: await this.licence.featuresFor(device.storeId) };
  }
}
