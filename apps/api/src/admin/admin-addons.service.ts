import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  CURRENT_STORE_ADDON_STATUSES,
  type AddonCategory,
  type AddonInterval,
  type AddonKind,
  type AddonScope,
  type AddonStatus,
  type AddonUnit,
  type StoreAddonSource,
} from '@restrovia/shared';
import {
  currentStoreAddon,
  storeAddonEndsAt,
  storeAddonInUse,
  trialUsed,
} from '../addons/store-addons.js';
import { ConfigService } from '@nestjs/config';
import { addonEmails, closeRequests, type ClosedRequest } from '../addons/addon-requests.js';
import { CommandsService } from '../commands/commands.service.js';
import { storeCode } from '../common/store-code.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { DB, type Database } from '../db/database.module.js';
import {
  addonPayments,
  addonRequests,
  addons,
  owners,
  storeAddons,
  stores,
} from '../db/schema/index.js';
import { isUniqueViolation } from '../pos/register.service.js';
import type { AdminRow } from './admin-auth.service.js';
import { writeAudit } from './audit.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type AddonInput = {
  code: string;
  name: string;
  tagline?: string;
  description?: string;
  category: AddonCategory;
  kind: AddonKind;
  price: string;
  currency: string;
  interval: AddonInterval;
  unit: AddonUnit;
  trial_days: number;
  requires: string[];
  min_pos_version?: string | null;
  scope: AddonScope;
  status: AddonStatus;
  sort_order: number;
  is_featured: boolean;
};
export type AddonUpdate = Partial<Omit<AddonInput, 'code'>>;

export type StoreAddonAction =
  | {
      action: 'grant';
      addon_code: string;
      source: StoreAddonSource;
      quantity: number;
      months?: number | null;
      price?: string;
      amount?: string;
      note: string;
    }
  | { action: 'trial'; addon_code: string; note?: string };
export type AddonPaymentInput = { amount: string; months?: number; note?: string };
export type AddonRevokeInput = { immediate: boolean; note: string };

function addMonths(from: Date, months: number): Date {
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

/** Months one payment buys at the add-on's interval; null when it is not billed again. */
function periodMonths(interval: string): number | null {
  if (interval === 'month') return 1;
  if (interval === 'year') return 12;
  return null;
}

/**
 * The marketplace catalogue and each store's add-ons, as the admin panel manages them. Every change
 * is written to the audit log in the same transaction, then the store's POS is told to fetch its
 * licence, which lists the add-ons the POS enforces.
 */
@Injectable()
export class AdminAddonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The catalogue with how many stores use each add-on now; retired ones only on request. */
  async listAddons(includeRetired = false) {
    return this.db
      .select({
        id: addons.id,
        code: addons.code,
        name: addons.name,
        tagline: addons.tagline,
        description: addons.description,
        category: addons.category,
        kind: addons.kind,
        price: addons.price,
        currency: addons.currency,
        interval: addons.interval,
        unit: addons.unit,
        trial_days: addons.trialDays,
        requires: addons.requires,
        min_pos_version: addons.minPosVersion,
        scope: addons.scope,
        status: addons.status,
        sort_order: addons.sortOrder,
        is_featured: addons.isFeatured,
        created_at: addons.createdAt,
        updated_at: addons.updatedAt,
        active_stores: sql<number>`(select count(*)::int from store_addons sa
          where sa.addon_id = "addons"."id"
            and sa.status in ('trial', 'active', 'cancelled')
            and coalesce(case when sa.status = 'trial' then sa.trial_ends_at
              else sa.current_period_end end, 'infinity') > now())`,
      })
      .from(addons)
      .where(includeRetired ? undefined : ne(addons.status, 'retired'))
      .orderBy(asc(addons.sortOrder), asc(addons.name));
  }

  async createAddon(input: AddonInput, admin: AdminRow, ip: string | null) {
    await this.checkRequires(this.db, input.code, input.requires);
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(addons)
          .values({
            code: input.code,
            name: input.name,
            tagline: input.tagline ?? '',
            description: input.description ?? '',
            category: input.category,
            kind: input.kind,
            price: input.price,
            currency: input.currency,
            interval: input.interval,
            unit: input.unit,
            trialDays: input.trial_days,
            requires: input.requires,
            minPosVersion: input.min_pos_version ?? null,
            scope: input.scope,
            status: input.status,
            sortOrder: input.sort_order,
            isFeatured: input.is_featured,
          })
          .returning();
        await writeAudit(tx, {
          adminId: admin.id,
          action: 'addon.create',
          targetType: 'addon',
          targetId: row.id,
          details: { ...input },
          ip,
        });
        return publicAddon(row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'addon_code_in_use' });
      throw err;
    }
  }

  /**
   * The code is fixed once an add-on exists, because licences and the POS refer to it. A new price
   * applies to sales from now on; add-ons already sold keep the price they were sold at.
   */
  async updateAddon(id: string, input: AddonUpdate, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const before = await tx.query.addons.findFirst({ where: eq(addons.id, id) });
      if (!before) throw new NotFoundException({ error: 'addon_not_found' });
      if (input.requires) await this.checkRequires(tx, before.code, input.requires);
      const [row] = await tx
        .update(addons)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.tagline !== undefined && { tagline: input.tagline }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.category !== undefined && { category: input.category }),
          ...(input.kind !== undefined && { kind: input.kind }),
          ...(input.price !== undefined && { price: input.price }),
          ...(input.currency !== undefined && { currency: input.currency }),
          ...(input.interval !== undefined && { interval: input.interval }),
          ...(input.unit !== undefined && { unit: input.unit }),
          ...(input.trial_days !== undefined && { trialDays: input.trial_days }),
          ...(input.requires !== undefined && { requires: input.requires }),
          ...(input.min_pos_version !== undefined && { minPosVersion: input.min_pos_version }),
          ...(input.scope !== undefined && { scope: input.scope }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.sort_order !== undefined && { sortOrder: input.sort_order }),
          ...(input.is_featured !== undefined && { isFeatured: input.is_featured }),
          updatedAt: new Date(),
        })
        .where(eq(addons.id, id))
        .returning();
      const changed = Object.keys(input) as (keyof AddonUpdate)[];
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'addon.update',
        targetType: 'addon',
        targetId: id,
        details: {
          changes: input,
          before: Object.fromEntries(changed.map((k) => [k, this.publicValue(before, k)])),
        },
        ip,
      });
      return publicAddon(row);
    });
  }

  /** Every add-on the store has had, newest first, with its payments and whether it is in use. */
  async listStoreAddons(storeId: string, now = new Date()) {
    await this.requireStore(storeId);
    const rows = await this.db
      .select({ sa: storeAddons, code: addons.code, name: addons.name, interval: addons.interval })
      .from(storeAddons)
      .innerJoin(addons, eq(addons.id, storeAddons.addonId))
      .where(eq(storeAddons.storeId, storeId))
      .orderBy(desc(storeAddons.createdAt));
    const payments = rows.length
      ? await this.db
          .select()
          .from(addonPayments)
          .where(
            inArray(
              addonPayments.storeAddonId,
              rows.map((r) => r.sa.id),
            ),
          )
          .orderBy(desc(addonPayments.paidAt))
      : [];
    return rows.map(({ sa, code, name, interval }) => ({
      ...publicStoreAddon(sa, now),
      addon_code: code,
      addon_name: name,
      interval,
      payments: payments
        .filter((p) => p.storeAddonId === sa.id)
        .map((p) => ({
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          method: p.method,
          status: p.status,
          paid_at: p.paidAt,
        })),
    }));
  }

  /** Gives a store an add-on, or starts its one free trial. */
  async addToStore(storeId: string, input: StoreAddonAction, admin: AdminRow, ip: string | null) {
    await this.requireStore(storeId);
    const now = new Date();
    let fulfilled: ClosedRequest[] = [];
    const result = await this.db.transaction(async (tx) => {
      const addon = await tx.query.addons.findFirst({ where: eq(addons.code, input.addon_code) });
      if (!addon) throw new BadRequestException({ error: 'unknown_addon' });
      if (addon.status === 'retired') throw new ConflictException({ error: 'addon_retired' });
      const current = await currentStoreAddon(tx, storeId, addon.id, now);
      if (current) throw new ConflictException({ error: 'addon_already_added' });

      if (input.action === 'trial') {
        if (addon.trialDays === 0) throw new ConflictException({ error: 'addon_has_no_trial' });
        if (await trialUsed(tx, storeId, addon.id))
          throw new ConflictException({ error: 'addon_trial_used' });
        const trialEndsAt = new Date(now.getTime() + addon.trialDays * 86_400_000);
        const [row] = await tx
          .insert(storeAddons)
          .values({
            storeId,
            addonId: addon.id,
            status: 'trial',
            source: 'admin_grant',
            price: addon.price,
            currency: addon.currency,
            trialEndsAt,
            grantedByAdmin: admin.id,
            note: input.note ?? null,
          })
          .returning();
        await this.audit(tx, storeId, 'store_addon.trial', input, row, admin, ip);
        return row;
      }

      const months = input.months === undefined ? periodMonths(addon.interval) : input.months;
      const [row] = await tx
        .insert(storeAddons)
        .values({
          storeId,
          addonId: addon.id,
          status: 'active',
          source: input.source,
          quantity: input.quantity,
          price: input.price ?? addon.price,
          currency: addon.currency,
          currentPeriodStart: now,
          currentPeriodEnd: months === null ? null : addMonths(now, months),
          grantedByAdmin: admin.id,
          note: input.note,
        })
        .returning();
      if (input.amount !== undefined) {
        await tx.insert(addonPayments).values({
          storeAddonId: row.id,
          amount: input.amount,
          currency: addon.currency,
          method: 'manual',
          recordedByAdmin: admin.id,
          paidAt: now,
        });
      }
      await this.audit(tx, storeId, 'store_addon.grant', input, row, admin, ip);
      fulfilled = await closeRequests(
        tx,
        { storeId, addonId: addon.id },
        { status: 'done', adminId: admin.id },
        now,
      );
      return row;
    });
    await this.refreshLicence(storeId, admin);
    this.tellRequesters(fulfilled, 'done');
    return publicStoreAddon(result, now);
  }

  /** A manual payment extends the add-on by one period (or `months`) from its end, or from now. */
  async recordPayment(
    storeId: string,
    storeAddonId: string,
    input: AddonPaymentInput,
    admin: AdminRow,
    ip: string | null,
  ) {
    const now = new Date();
    let fulfilled: ClosedRequest[] = [];
    const result = await this.db.transaction(async (tx) => {
      const { row, addon } = await this.currentRow(tx, storeId, storeAddonId);
      const months = input.months ?? periodMonths(addon.interval);
      if (months === null) throw new ConflictException({ error: 'addon_not_renewable' });
      const end = storeAddonEndsAt(row);
      if (end === null && row.status !== 'trial') {
        throw new ConflictException({ error: 'addon_never_ends' });
      }
      const start = end && end > now ? end : now;
      const [updated] = await tx
        .update(storeAddons)
        .set({
          status: 'active',
          currentPeriodStart: row.status === 'active' ? row.currentPeriodStart : now,
          currentPeriodEnd: addMonths(start, months),
          cancelledAt: null,
          updatedAt: now,
        })
        .where(eq(storeAddons.id, row.id))
        .returning();
      await tx.insert(addonPayments).values({
        storeAddonId: row.id,
        amount: input.amount,
        currency: row.currency,
        method: 'manual',
        recordedByAdmin: admin.id,
        paidAt: now,
      });
      await this.audit(tx, storeId, 'store_addon.payment', input, updated, admin, ip);
      fulfilled = await closeRequests(
        tx,
        { storeId, addonId: addon.id },
        { status: 'done', adminId: admin.id },
        now,
      );
      return updated;
    });
    await this.refreshLicence(storeId, admin);
    this.tellRequesters(fulfilled, 'done');
    return publicStoreAddon(result, now);
  }

  /**
   * Stops an add-on. Without `immediate` it is cancelled and runs to its paid end; one that never
   * ends, or a trial, stops at once.
   */
  async revoke(
    storeId: string,
    storeAddonId: string,
    input: AddonRevokeInput,
    admin: AdminRow,
    ip: string | null,
  ) {
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const { row } = await this.currentRow(tx, storeId, storeAddonId);
      const atOnce = input.immediate || row.status === 'trial' || storeAddonEndsAt(row) === null;
      const [updated] = await tx
        .update(storeAddons)
        .set(
          atOnce
            ? {
                status: 'revoked',
                revokedAt: now,
                ...(row.status === 'trial' ? { trialEndsAt: now } : { currentPeriodEnd: now }),
                updatedAt: now,
              }
            : { status: 'cancelled', cancelledAt: now, updatedAt: now },
        )
        .where(eq(storeAddons.id, row.id))
        .returning();
      await this.audit(tx, storeId, 'store_addon.revoke', input, updated, admin, ip);
      return updated;
    });
    await this.refreshLicence(storeId, admin);
    return publicStoreAddon(result, now);
  }

  /** Cafés' requests to buy paid add-ons, newest first; one store's with `storeId`. */
  async listRequests(status: string, storeId?: string) {
    const rows = await this.db
      .select({
        r: addonRequests,
        storeName: stores.name,
        code: addons.code,
        name: addons.name,
        price: addons.price,
        currency: addons.currency,
        interval: addons.interval,
        unit: addons.unit,
        email: owners.email,
      })
      .from(addonRequests)
      .innerJoin(stores, eq(stores.id, addonRequests.storeId))
      .innerJoin(addons, eq(addons.id, addonRequests.addonId))
      .leftJoin(owners, eq(owners.id, addonRequests.requestedByOwner))
      .where(
        and(
          eq(addonRequests.status, status),
          ...(storeId ? [eq(addonRequests.storeId, storeId)] : []),
        ),
      )
      .orderBy(desc(addonRequests.createdAt))
      .limit(200);
    return rows.map(({ r, storeName, code, name, price, currency, interval, unit, email }) => ({
      id: r.id,
      store_id: r.storeId,
      store_name: storeName,
      store_code: storeCode(r.storeId),
      addon_code: code,
      addon_name: name,
      price,
      currency,
      interval,
      unit,
      quantity: r.quantity,
      note: r.note,
      status: r.status,
      requested_by: email,
      created_at: r.createdAt,
      resolved_at: r.resolvedAt,
      resolution_note: r.resolutionNote,
    }));
  }

  /** Says no to a café's request, with a note the owner reads. */
  async declineRequest(
    storeId: string,
    requestId: string,
    note: string,
    admin: AdminRow,
    ip: string | null,
  ) {
    const now = new Date();
    const closed = await this.db.transaction(async (tx) => {
      const rows = await closeRequests(
        tx,
        { storeId, requestId },
        { status: 'declined', adminId: admin.id, note },
        now,
      );
      if (rows.length === 0) throw new NotFoundException({ error: 'request_not_found' });
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'addon_request.decline',
        targetType: 'store',
        targetId: storeId,
        details: { request_id: requestId, note },
        ip,
      });
      return rows;
    });
    this.tellRequesters(closed, 'declined', note);
    return { ok: true };
  }

  private tellRequesters(closed: ClosedRequest[], outcome: 'done' | 'declined', note?: string) {
    const ownerAppUrl = this.config.get('OWNER_APP_URL', { infer: true });
    for (const r of closed) {
      const mail = addonEmails.closed(r, outcome, note, ownerAppUrl);
      if (mail) this.email.queue(mail);
    }
  }

  private async currentRow(tx: Tx, storeId: string, storeAddonId: string) {
    const found = await tx
      .select({ row: storeAddons, addon: addons })
      .from(storeAddons)
      .innerJoin(addons, eq(addons.id, storeAddons.addonId))
      .where(and(eq(storeAddons.id, storeAddonId), eq(storeAddons.storeId, storeId)))
      .for('update', { of: storeAddons });
    if (found.length === 0) throw new NotFoundException({ error: 'store_addon_not_found' });
    const [{ row, addon }] = found;
    if (!(CURRENT_STORE_ADDON_STATUSES as readonly string[]).includes(row.status)) {
      throw new ConflictException({ error: 'store_addon_not_current' });
    }
    return { row, addon };
  }

  private async checkRequires(tx: Tx | Database, code: string, requires: string[]) {
    if (requires.includes(code)) throw new BadRequestException({ error: 'addon_requires_itself' });
    if (requires.length === 0) return;
    const found = await tx
      .select({ code: addons.code })
      .from(addons)
      .where(inArray(addons.code, requires));
    if (found.length !== new Set(requires).size) {
      throw new BadRequestException({ error: 'unknown_required_addon' });
    }
  }

  private async requireStore(storeId: string) {
    const store = await this.db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { id: true },
    });
    if (!store) throw new NotFoundException({ error: 'store_not_found' });
  }

  private publicValue(row: typeof addons.$inferSelect, key: keyof AddonUpdate): unknown {
    const map: Record<keyof AddonUpdate, unknown> = {
      name: row.name,
      tagline: row.tagline,
      description: row.description,
      category: row.category,
      kind: row.kind,
      price: row.price,
      currency: row.currency,
      interval: row.interval,
      unit: row.unit,
      trial_days: row.trialDays,
      requires: row.requires,
      min_pos_version: row.minPosVersion,
      scope: row.scope,
      status: row.status,
      sort_order: row.sortOrder,
      is_featured: row.isFeatured,
    };
    return map[key];
  }

  private async audit(
    tx: Tx,
    storeId: string,
    action: string,
    input: object,
    result: typeof storeAddons.$inferSelect,
    admin: AdminRow,
    ip: string | null,
  ) {
    await writeAudit(tx, {
      adminId: admin.id,
      action,
      targetType: 'store',
      targetId: storeId,
      details: {
        ...input,
        result: {
          store_addon_id: result.id,
          status: result.status,
          ends_at: storeAddonEndsAt(result),
        },
      },
      ip,
    });
  }

  /** Best effort: a POS that misses this still learns at its next licence check-in. */
  private async refreshLicence(storeId: string, admin: AdminRow) {
    await this.commands.requestLicenceRefresh(storeId, admin.id).catch(() => undefined);
  }
}

function publicAddon(row: typeof addons.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    kind: row.kind,
    price: row.price,
    currency: row.currency,
    interval: row.interval,
    unit: row.unit,
    trial_days: row.trialDays,
    requires: row.requires,
    min_pos_version: row.minPosVersion,
    scope: row.scope,
    status: row.status,
    sort_order: row.sortOrder,
    is_featured: row.isFeatured,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function publicStoreAddon(row: typeof storeAddons.$inferSelect, now: Date) {
  return {
    id: row.id,
    status: row.status,
    in_use: storeAddonInUse(row, now),
    source: row.source,
    quantity: row.quantity,
    price: row.price,
    currency: row.currency,
    trial_ends_at: row.trialEndsAt,
    current_period_start: row.currentPeriodStart,
    current_period_end: row.currentPeriodEnd,
    ends_at: storeAddonEndsAt(row),
    cancelled_at: row.cancelledAt,
    revoked_at: row.revokedAt,
    note: row.note,
    created_at: row.createdAt,
  };
}
