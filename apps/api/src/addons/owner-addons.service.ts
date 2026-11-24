import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CURRENT_STORE_ADDON_STATUSES, type StoreMemberRole } from '@restrovia/shared';
import { writeAudit } from '../admin/audit.js';
import { CommandsService } from '../commands/commands.service.js';
import { storeCode } from '../common/store-code.js';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/database.module.js';
import { addonPayments, addonRequests, addons, owners, storeAddons } from '../db/schema/index.js';
import { EmailService } from '../email/email.service.js';
import type { OwnerRow } from '../owner/owner-sessions.js';
import type { StoreRow } from '../owner-stores/store-member.guard.js';
import { isUniqueViolation } from '../pos/register.service.js';
import { addonEmails, closeRequests } from './addon-requests.js';
import { isFree, PosAddonsService, type PosAddMode } from './pos-addons.service.js';
import { storeAddonEndsAt, storeAddonInUse } from './store-addons.js';

/** Add-ons an owner can stop themselves; ones Restrovia gave or kept free need Restrovia. */
const OWNER_CANCELLABLE_SOURCES = ['purchase', 'free'];

/**
 * The owner portal Marketplace. Owners add free add-ons and start trials themselves. Paid add-ons
 * are requested: Restrovia takes the payment and adds them, which closes the request. Managers see
 * everything and can request; only owners add, start trials or cancel.
 */
@Injectable()
export class OwnerAddonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly posAddons: PosAddonsService,
    private readonly commands: CommandsService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async marketplace(store: StoreRow, role: StoreMemberRole, now = new Date()) {
    const [{ addons: catalogue }, mine, requests] = await Promise.all([
      this.posAddons.catalogue(store.id, now),
      this.mine(store.id, role, now),
      this.db
        .select({ r: addonRequests, code: addons.code, name: addons.name, email: owners.email })
        .from(addonRequests)
        .innerJoin(addons, eq(addons.id, addonRequests.addonId))
        .leftJoin(owners, eq(owners.id, addonRequests.requestedByOwner))
        .where(eq(addonRequests.storeId, store.id))
        .orderBy(desc(addonRequests.createdAt))
        .limit(20),
    ]);
    const pending = new Map(
      requests.filter(({ r }) => r.status === 'pending').map(({ r, code }) => [code, r]),
    );
    return {
      role,
      addons: catalogue.map((a) => {
        const request = pending.get(a.code);
        return {
          ...a,
          pending_request: request
            ? { id: request.id, quantity: request.quantity, created_at: request.createdAt }
            : null,
          can_request: a.state !== 'in_plan' && !isFree(a) && !request,
        };
      }),
      mine,
      requests: requests.map(({ r, code, name, email }) => ({
        id: r.id,
        addon_code: code,
        addon_name: name,
        quantity: r.quantity,
        note: r.note,
        status: r.status,
        requested_by: email,
        created_at: r.createdAt,
        resolved_at: r.resolvedAt,
        resolution_note: r.resolutionNote,
      })),
    };
  }

  add(store: StoreRow, owner: OwnerRow, code: string, mode: PosAddMode) {
    return this.posAddons.add(store.id, code, mode, { by: 'owner', ownerId: owner.id });
  }

  /** Asks Restrovia to sell the café a paid add-on (or renew one); one pending per add-on. */
  async request(store: StoreRow, owner: OwnerRow, code: string, quantity: number, note: string) {
    const { addons: catalogue } = await this.posAddons.catalogue(store.id);
    const addon = catalogue.find((a) => a.code === code);
    if (!addon) throw new NotFoundException({ error: 'addon_not_found' });
    if (addon.state === 'in_plan') throw new ConflictException({ error: 'addon_in_plan' });
    if (isFree(addon)) throw new ConflictException({ error: 'addon_is_free' });
    const count = addon.unit === 'outlet' ? 1 : quantity;
    const row = await this.db
      .transaction(async (tx) => {
        const [found] = await tx
          .select({ id: addons.id })
          .from(addons)
          .where(eq(addons.code, code));
        const [inserted] = await tx
          .insert(addonRequests)
          .values({
            storeId: store.id,
            addonId: found.id,
            quantity: count,
            note,
            requestedByOwner: owner.id,
          })
          .returning();
        await writeAudit(tx, {
          adminId: null,
          action: 'addon_request.create',
          targetType: 'store',
          targetId: store.id,
          details: { addon_code: code, quantity: count, by: 'owner', owner_id: owner.id },
        });
        return inserted;
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) throw new ConflictException({ error: 'request_pending' });
        throw err;
      });
    const sales = this.config.get('LEADS_NOTIFY_EMAIL', { infer: true });
    if (sales) {
      const adminUrl = this.config.get('ADMIN_APP_URL', { infer: true });
      this.email.queue(
        addonEmails.requested(
          sales,
          {
            storeName: store.name,
            storeCode: storeCode(store.id),
            addonName: addon.name,
            quantity: count,
            note,
          },
          owner.email,
          `${adminUrl}/dashboard/stores/${store.id}`,
        ),
      );
    }
    return { id: row.id, status: row.status, quantity: row.quantity };
  }

  async cancelRequest(store: StoreRow, owner: OwnerRow, requestId: string) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const closed = await closeRequests(
        tx,
        { storeId: store.id, requestId },
        { status: 'cancelled', adminId: null },
        now,
      );
      if (closed.length === 0) throw new NotFoundException({ error: 'request_not_found' });
      await writeAudit(tx, {
        adminId: null,
        action: 'addon_request.cancel',
        targetType: 'store',
        targetId: store.id,
        details: { request_id: requestId, by: 'owner', owner_id: owner.id },
      });
    });
    return { ok: true };
  }

  /**
   * Stops an add-on the café added itself. A paid one runs to its paid end; a trial or a free one
   * stops now. Add-ons Restrovia gave or kept free are stopped through Restrovia.
   */
  async cancel(store: StoreRow, owner: OwnerRow, storeAddonId: string) {
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(storeAddons)
        .where(and(eq(storeAddons.id, storeAddonId), eq(storeAddons.storeId, store.id)))
        .for('update');
      if (!row || !storeAddonInUse(row, now)) {
        throw new NotFoundException({ error: 'store_addon_not_found' });
      }
      if (!OWNER_CANCELLABLE_SOURCES.includes(row.source)) {
        throw new ConflictException({ error: 'cancel_through_restrovia' });
      }
      if (row.status === 'cancelled') throw new ConflictException({ error: 'already_cancelled' });
      const atOnce = row.status === 'trial' || storeAddonEndsAt(row) === null;
      const [updated] = await tx
        .update(storeAddons)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          updatedAt: now,
          // A cancelled row ends at its period end, so stopping now sets it, for a trial too.
          ...(atOnce && {
            currentPeriodEnd: now,
            ...(row.status === 'trial' && { trialEndsAt: now }),
          }),
        })
        .where(eq(storeAddons.id, row.id))
        .returning();
      await writeAudit(tx, {
        adminId: null,
        action: 'store_addon.cancel',
        targetType: 'store',
        targetId: store.id,
        details: {
          store_addon_id: row.id,
          by: 'owner',
          owner_id: owner.id,
          at_once: atOnce,
          ends_at: storeAddonEndsAt(updated),
        },
      });
      return updated;
    });
    await this.commands.requestLicenceRefresh(store.id).catch(() => undefined);
    return { status: result.status, ends_at: storeAddonEndsAt(result) };
  }

  /** The café's add-ons in use, with their payments. */
  private async mine(storeId: string, role: StoreMemberRole, now: Date) {
    const rows = await this.db
      .select({ sa: storeAddons, code: addons.code, name: addons.name, interval: addons.interval })
      .from(storeAddons)
      .innerJoin(addons, eq(addons.id, storeAddons.addonId))
      .where(
        and(
          eq(storeAddons.storeId, storeId),
          inArray(storeAddons.status, [...CURRENT_STORE_ADDON_STATUSES]),
        ),
      )
      .orderBy(desc(storeAddons.createdAt));
    const current = rows.filter(({ sa }) => storeAddonInUse(sa, now));
    const payments = current.length
      ? await this.db
          .select()
          .from(addonPayments)
          .where(
            inArray(
              addonPayments.storeAddonId,
              current.map(({ sa }) => sa.id),
            ),
          )
          .orderBy(desc(addonPayments.paidAt))
      : [];
    return current.map(({ sa, code, name, interval }) => ({
      id: sa.id,
      addon_code: code,
      addon_name: name,
      interval,
      status: sa.status,
      source: sa.source,
      quantity: sa.quantity,
      price: sa.price,
      currency: sa.currency,
      started_at: sa.status === 'trial' ? sa.createdAt : (sa.currentPeriodStart ?? sa.createdAt),
      ends_at: storeAddonEndsAt(sa),
      cancelled_at: sa.cancelledAt,
      can_cancel:
        role === 'owner' &&
        OWNER_CANCELLABLE_SOURCES.includes(sa.source) &&
        sa.status !== 'cancelled',
      payments: payments
        .filter((p) => p.storeAddonId === sa.id)
        .map((p) => ({ amount: p.amount, currency: p.currency, paid_at: p.paidAt })),
    }));
  }
}
