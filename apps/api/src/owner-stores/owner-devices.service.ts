import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { CURRENT_SUBSCRIPTION_STATUSES } from '@restrovia/shared';
import { storeCode } from '../common/store-code.js';
import { DB, type Database } from '../db/database.module.js';
import {
  deviceLinkCodes,
  ownerSecurityEvents,
  plans,
  posDevices,
  storeMembers,
  stores,
  subscriptions,
} from '../db/schema/index.js';
import { recordEvent, type OwnerRow, type RequestContext } from '../owner/owner-sessions.js';
import { DeviceLinkService } from '../pos/device-link.service.js';
import { DeviceMoveService } from '../pos/device-move.service.js';
import { deviceLastSeen, isOnline } from '../pos/device-status.js';
import { CommandsService } from '../commands/commands.service.js';
import type { StoreRow } from './store-member.guard.js';

/** Wrong codes allowed in the window before linking pauses for that person. */
const LINK_FAILURES = 5;
const LINK_WINDOW_MS = 15 * 60_000;

const wrongCode = () => new BadRequestException({ error: 'invalid_link_code' });

type Found = {
  codeId: string;
  machineIdHash: string;
  device: typeof posDevices.$inferSelect;
  source: StoreRow;
};

/**
 * The café's POS computers in the owner portal. An owner moves a POS to their café with the code
 * it shows (a new computer or a reinstall), keeping the café's trial or plan, or switches one off.
 */
@Injectable()
export class OwnerDevicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly links: DeviceLinkService,
    private readonly moves: DeviceMoveService,
    private readonly commands: CommandsService,
  ) {}

  async list(store: StoreRow) {
    const rows = await this.db
      .select({
        id: posDevices.id,
        name: posDevices.deviceName,
        platform: posDevices.platform,
        app_version: posDevices.appVersion,
        last_seen_at: deviceLastSeen,
        created_at: posDevices.createdAt,
      })
      .from(posDevices)
      .where(and(eq(posDevices.storeId, store.id), isNull(posDevices.revokedAt)))
      .orderBy(sql`${deviceLastSeen} desc nulls last`);
    return {
      devices: rows.map((r) => ({
        ...r,
        last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
        online: isOnline(r.last_seen_at),
      })),
    };
  }

  async preview(me: OwnerRow, store: StoreRow, code: string, ctx: RequestContext) {
    const found = await this.findCode(me, store, code, ctx);
    const current = await this.list(store);
    const others = current.devices.filter((d) => d.id !== found.device.id);
    const [sameComputer] = await this.db
      .select({ id: posDevices.id })
      .from(posDevices)
      .where(
        and(
          eq(posDevices.storeId, store.id),
          eq(posDevices.machineIdHash, found.machineIdHash),
          isNull(posDevices.revokedAt),
        ),
      );
    const maxDevices = await this.maxDevices(store.id);
    // Suggest the computer this one replaces: the same computer, or the only other one when it is
    // offline. A computer billing right now is never pre-selected, in case this is the wrong café.
    const suggested =
      sameComputer && sameComputer.id !== found.device.id
        ? sameComputer.id
        : others.length === 1 && !others[0].online
          ? others[0].id
          : null;
    return {
      target_store: { name: store.name, code: storeCode(store.id) },
      max_devices: maxDevices,
      must_retire: others.length + 1 > maxDevices,
      computer: {
        id: found.device.id,
        name: found.device.deviceName,
        platform: found.device.platform,
        app_version: found.device.appVersion,
      },
      from_store:
        found.source.id === store.id
          ? null
          : { name: found.source.name, code: storeCode(found.source.id) },
      already_in_this_store: found.source.id === store.id,
      can_retire: others,
      suggested_retire_id: suggested,
    };
  }

  /** How many computers the café's current plan allows; one on a trial or without a plan. */
  private async maxDevices(storeId: string): Promise<number> {
    const [current] = await this.db
      .select({ maxDevices: plans.maxDevices })
      .from(subscriptions)
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      );
    return current?.maxDevices ?? 1;
  }

  async link(
    me: OwnerRow,
    store: StoreRow,
    input: { code: string; retire_device_id?: string | null },
    ctx: RequestContext,
  ) {
    const found = await this.findCode(me, store, input.code, ctx);
    const claimed = await this.db
      .update(deviceLinkCodes)
      .set({ usedAt: new Date(), usedBy: me.id })
      .where(and(eq(deviceLinkCodes.id, found.codeId), isNull(deviceLinkCodes.usedAt)))
      .returning({ id: deviceLinkCodes.id });
    if (claimed.length === 0) throw wrongCode();
    try {
      const result = await this.moves.move({
        deviceId: found.device.id,
        targetStoreId: store.id,
        retireDeviceId: input.retire_device_id ?? null,
        machineIdHash: found.machineIdHash,
      });
      await recordEvent(this.db, me.id, 'owner.computer_linked', ctx);
      return { ok: true, device_id: result.device_id, retired_device_id: result.retired_device_id };
    } catch (err) {
      await this.db
        .update(deviceLinkCodes)
        .set({ usedAt: null, usedBy: null })
        .where(eq(deviceLinkCodes.id, found.codeId));
      throw err;
    }
  }

  async retire(me: OwnerRow, store: StoreRow, deviceId: string, ctx: RequestContext) {
    const rows = await this.db
      .update(posDevices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(posDevices.id, deviceId),
          eq(posDevices.storeId, store.id),
          isNull(posDevices.revokedAt),
        ),
      )
      .returning({ id: posDevices.id });
    if (rows.length === 0) throw new NotFoundException({ error: 'device_not_found' });
    await recordEvent(this.db, me.id, 'owner.computer_retired', ctx);
    await this.commands.requestLicenceRefresh(store.id, me.id).catch(() => undefined);
    return { ok: true };
  }

  /**
   * An open code, and a POS the owner may move: one in this café, one nobody else owns in the
   * portal, or one in another café of theirs. A POS whose café has a paid plan moves only through
   * support, so a plan is never lost by accident.
   */
  private async findCode(
    me: OwnerRow,
    store: StoreRow,
    code: string,
    ctx: RequestContext,
  ): Promise<Found> {
    const [recent] = await this.db
      .select({ n: count() })
      .from(ownerSecurityEvents)
      .where(
        and(
          eq(ownerSecurityEvents.ownerId, me.id),
          eq(ownerSecurityEvents.action, 'owner.computer_link_failed'),
          gt(ownerSecurityEvents.createdAt, new Date(Date.now() - LINK_WINDOW_MS)),
        ),
      );
    if ((recent?.n ?? 0) >= LINK_FAILURES) {
      throw new HttpException({ error: 'too_many_codes' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const [row] = await this.db
      .select({ code: deviceLinkCodes, device: posDevices, source: stores })
      .from(deviceLinkCodes)
      .innerJoin(posDevices, eq(posDevices.id, deviceLinkCodes.deviceId))
      .innerJoin(stores, eq(stores.id, posDevices.storeId))
      .where(
        and(
          eq(deviceLinkCodes.codeHash, this.links.codeHash(code)),
          isNull(deviceLinkCodes.usedAt),
          gt(deviceLinkCodes.expiresAt, new Date()),
          isNull(posDevices.revokedAt),
        ),
      );
    if (!row || row.source.status === 'deleted') {
      await recordEvent(this.db, me.id, 'owner.computer_link_failed', ctx);
      throw wrongCode();
    }

    if (row.source.id !== store.id) {
      const members = await this.db
        .select({ ownerId: storeMembers.ownerId, role: storeMembers.role })
        .from(storeMembers)
        .where(eq(storeMembers.storeId, row.source.id));
      const mine = members.some((m) => m.ownerId === me.id && m.role === 'owner');
      if (members.length > 0 && !mine) {
        throw new ConflictException({ error: 'computer_belongs_to_another_store' });
      }
      const [paid] = await this.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.storeId, row.source.id),
            inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
            sql`${subscriptions.status} <> 'trial'`,
          ),
        );
      if (paid) throw new ConflictException({ error: 'computer_store_has_plan' });
    }
    return {
      codeId: row.code.id,
      machineIdHash: row.code.machineIdHash,
      device: row.device,
      source: row.source,
    };
  }
}
