import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  LICENCE_FEATURES,
  planLicenceFeatures,
} from '@restrovia/shared';
import { writeAudit } from '../admin/audit.js';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { addons, plans, storeAddons, stores, subscriptions } from '../db/schema/index.js';
import { currentStoreAddon, storeAddonEndsAt, storeAddonInUse, trialUsed } from './store-addons.js';

/** Add-ons shown to stores: live ones, and beta ones for early users. */
const LISTED_STATUSES = ['live', 'beta'];
const DAY_MS = 86_400_000;

export type PosAddMode = 'free' | 'trial';

/**
 * What the POS Marketplace screen shows and can do by itself: list the add-ons with this store's
 * state, add a free add-on, start a free trial, and record add-ons the POS already used before
 * add-ons existed. Paid add-ons are bought through Restrovia, not from the POS.
 */
@Injectable()
export class PosAddonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
  ) {}

  async catalogue(storeId: string, now = new Date()) {
    const [catalogue, owned, planFeatures] = await Promise.all([
      this.db
        .select()
        .from(addons)
        .where(inArray(addons.status, LISTED_STATUSES))
        .orderBy(asc(addons.sortOrder), asc(addons.name)),
      this.db.select().from(storeAddons).where(eq(storeAddons.storeId, storeId)),
      this.planFeatures(storeId),
    ]);
    return {
      addons: catalogue.map((a) => {
        const current = owned.find((o) => o.addonId === a.id && storeAddonInUse(o, now));
        const trialTaken = owned.some((o) => o.addonId === a.id && o.trialEndsAt !== null);
        const inPlan = (planFeatures as readonly string[]).includes(a.code);
        return {
          code: a.code,
          name: a.name,
          tagline: a.tagline,
          description: a.description,
          category: a.category,
          kind: a.kind,
          price: a.price,
          currency: a.currency,
          interval: a.interval,
          unit: a.unit,
          trial_days: a.trialDays,
          min_pos_version: a.minPosVersion,
          status: a.status,
          is_featured: a.isFeatured,
          state: inPlan
            ? 'in_plan'
            : current
              ? current.status === 'trial'
                ? 'trial'
                : 'active'
              : 'available',
          ends_at: current ? storeAddonEndsAt(current) : null,
          can_add_free: !inPlan && !current && isFree(a),
          can_start_trial: !inPlan && !current && a.trialDays > 0 && !trialTaken,
          had_before: owned.some((o) => o.addonId === a.id),
        };
      }),
    };
  }

  /** A free add-on, or a paid add-on's one free trial, added from the POS. */
  async add(storeId: string, deviceId: string, code: string, mode: PosAddMode) {
    const now = new Date();
    const row = await this.db.transaction(async (tx) => {
      const addon = await tx.query.addons.findFirst({ where: eq(addons.code, code) });
      if (!addon || !LISTED_STATUSES.includes(addon.status)) {
        throw new NotFoundException({ error: 'addon_not_found' });
      }
      if (await currentStoreAddon(tx, storeId, addon.id, now)) {
        throw new ConflictException({ error: 'addon_already_added' });
      }
      if (mode === 'free' && !isFree(addon)) {
        throw new HttpException({ error: 'payment_required' }, HttpStatus.PAYMENT_REQUIRED);
      }
      if (mode === 'trial') {
        if (addon.trialDays === 0) throw new ConflictException({ error: 'addon_has_no_trial' });
        if (await trialUsed(tx, storeId, addon.id)) {
          throw new ConflictException({ error: 'addon_trial_used' });
        }
      }
      const [inserted] = await tx
        .insert(storeAddons)
        .values(
          mode === 'trial'
            ? {
                storeId,
                addonId: addon.id,
                status: 'trial',
                source: 'purchase',
                price: addon.price,
                currency: addon.currency,
                trialEndsAt: new Date(now.getTime() + addon.trialDays * DAY_MS),
                note: 'Trial started from the POS',
              }
            : {
                storeId,
                addonId: addon.id,
                status: 'active',
                source: 'free',
                price: '0',
                currency: addon.currency,
                currentPeriodStart: now,
                note: 'Added from the POS',
              },
        )
        .returning();
      await writeAudit(tx, {
        adminId: null,
        action: mode === 'trial' ? 'store_addon.trial' : 'store_addon.grant',
        targetType: 'store',
        targetId: storeId,
        details: {
          addon_code: code,
          by: 'pos',
          pos_device_id: deviceId,
          store_addon_id: inserted.id,
        },
      });
      return inserted;
    });
    await this.commands.requestLicenceRefresh(storeId).catch(() => undefined);
    return { code, status: row.status, ends_at: storeAddonEndsAt(row) };
  }

  /**
   * Once per store, the first time a POS reports which paid features it has switched on: each one
   * the plan does not include, and the store never had as an add-on, is kept free with no end date.
   * Cafés therefore keep what they used before features became add-ons.
   */
  async grandfather(storeId: string, enabled: string[], now = new Date()): Promise<void> {
    const codes = LICENCE_FEATURES.filter((c) => enabled.includes(c));
    await this.db.transaction(async (tx) => {
      const [store] = await tx
        .select({ at: stores.addonsGrandfatheredAt })
        .from(stores)
        .where(eq(stores.id, storeId))
        .for('update');
      if (!store || store.at) return;
      await tx.update(stores).set({ addonsGrandfatheredAt: now }).where(eq(stores.id, storeId));
      if (codes.length === 0) return;
      const planFeatures = await this.planFeatures(storeId, tx);
      const catalogue = await tx.select().from(addons).where(inArray(addons.code, codes));
      const had = await tx
        .select({ addonId: storeAddons.addonId })
        .from(storeAddons)
        .where(eq(storeAddons.storeId, storeId));
      const kept: string[] = [];
      for (const addon of catalogue) {
        if ((planFeatures as readonly string[]).includes(addon.code)) continue;
        if (had.some((h) => h.addonId === addon.id)) continue;
        await tx.insert(storeAddons).values({
          storeId,
          addonId: addon.id,
          status: 'active',
          source: 'grandfathered',
          price: '0',
          currency: addon.currency,
          currentPeriodStart: now,
          note: 'In use on the POS before add-ons; kept free',
        });
        kept.push(addon.code);
      }
      await writeAudit(tx, {
        adminId: null,
        action: 'store_addon.grandfather',
        targetType: 'store',
        targetId: storeId,
        details: { reported: codes, kept },
      });
    });
  }

  private async planFeatures(storeId: string, tx: Pick<Database, 'select'> = this.db) {
    const [row] = await tx
      .select({ features: plans.features })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      );
    return row ? planLicenceFeatures(row.features) : [];
  }
}

function isFree(addon: { kind: string; price: string }) {
  return (addon.kind === 'free' || addon.kind === 'included') && Number(addon.price) === 0;
}
