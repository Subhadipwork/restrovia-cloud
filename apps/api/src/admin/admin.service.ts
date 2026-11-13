import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  type AdminRole,
  type TicketStatus,
} from '@restrovia/shared';
import { CommandsService } from '../commands/commands.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import { EmailService } from '../email/email.service.js';
import { ownerEmails } from '../owner/owner-emails.js';
import {
  adminAuditLog,
  admins,
  dailyStoreStats,
  owners,
  plans,
  posBackups,
  posDevices,
  posPresence,
  storeBlocks,
  storeMembers,
  stores,
  subscriptionPayments,
  subscriptions,
  supportTicketNotes,
  supportTickets,
} from '../db/schema/index.js';
import { deviceLastSeen, POS_ONLINE_MINUTES as ONLINE_MINUTES } from '../pos/device-status.js';
import { isUniqueViolation } from '../pos/register.service.js';
import type { AdminRow } from './admin-auth.service.js';
import { toPublic } from './admin-auth.service.js';
import { writeAudit } from './audit.js';

const DAY_MS = 86_400_000;

export type LicenceAction =
  | { action: 'extend_trial'; days: number; note?: string }
  | { action: 'activate'; plan_code: string; amount?: string; note?: string }
  | { action: 'suspend'; immediate?: boolean; note?: string };

export type PlanInput = {
  code: string;
  name: string;
  price: string;
  currency: string;
  interval: 'month' | 'year';
  max_devices: number;
  features?: Record<string, unknown>;
};
export type PlanUpdate = Partial<Pick<PlanInput, 'name' | 'price' | 'max_devices' | 'features'>> & {
  is_active?: boolean;
};

export type Page = { page: number; perPage: number };

export type StoreStatusInput =
  | { action: 'block'; reason: string; notify_owners: boolean }
  | { action: 'unblock'; notify_owners: boolean };

const ONLINE_HISTORY_DAYS = 30;
const ONLINE_PERIODS_SHOWN = 100;
const BACKUPS_SHOWN = 50;
const ACTIVITY_SHOWN = 50;
const offset = (p: Page) => (p.page - 1) * p.perPage;

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly commands: CommandsService,
  ) {}

  async overview() {
    const onlineSince = new Date(Date.now() - ONLINE_MINUTES * 60_000);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [storeCounts, online, newThisMonth, licences, versions, openTickets] = await Promise.all([
      this.db.select({ status: stores.status, n: count() }).from(stores).groupBy(stores.status),
      this.db
        .select({ n: sql<number>`count(distinct ${posDevices.storeId})::int` })
        .from(posDevices)
        .where(gte(deviceLastSeen, onlineSince)),
      this.db.select({ n: count() }).from(stores).where(gte(stores.createdAt, monthStart)),
      this.db.execute<{ status: string; n: number }>(sql`
        select coalesce(cur.status, 'none') as status, count(*)::int as n
        from stores s
        left join lateral (
          select status from subscriptions where store_id = s.id order by created_at desc limit 1
        ) cur on true
        where s.status <> 'deleted'
        group by 1`),
      this.db
        .select({ version: posDevices.appVersion, n: count() })
        .from(posDevices)
        .groupBy(posDevices.appVersion)
        .orderBy(desc(count())),
      this.db
        .select({ n: count() })
        .from(supportTickets)
        .where(inArray(supportTickets.status, ['open', 'in_progress'])),
    ]);

    return {
      stores: Object.fromEntries(storeCounts.map((r) => [r.status, r.n])),
      online_now: online[0]?.n ?? 0,
      new_this_month: newThisMonth[0]?.n ?? 0,
      licences: Object.fromEntries(licences.rows.map((r) => [r.status, r.n])),
      versions: versions.map((v) => ({ version: v.version ?? 'unknown', count: v.n })),
      open_tickets: openTickets[0]?.n ?? 0,
    };
  }

  async listStores(filters: { search?: string; status?: string; licence?: string }, page: Page) {
    const where: SQL[] = [];
    if (filters.search) {
      const term = `%${filters.search.replace(/[%_]/g, '\\$&')}%`;
      // The POS shows a store code (first 8 characters of the id); a code or a full id matches.
      const idPrefix = filters.search.replace(/-/g, '').toLowerCase();
      where.push(
        or(
          ilike(stores.name, term),
          ilike(stores.phone, term),
          ilike(sql`${stores.email}::text`, term),
          ilike(stores.address, term),
          /^[0-9a-f]{6,32}$/.test(idPrefix)
            ? sql`replace("stores"."id"::text, '-', '') like ${`${idPrefix}%`}`
            : undefined,
        )!,
      );
    }
    if (filters.status) where.push(eq(stores.status, filters.status));
    if (filters.licence) {
      where.push(
        sql`(select status from subscriptions where store_id = "stores"."id" order by created_at desc limit 1) = ${filters.licence}`,
      );
    }
    const cond = where.length ? and(...where) : undefined;

    const [rows, total] = await Promise.all([
      this.db
        .select({
          id: stores.id,
          name: stores.name,
          phone: stores.phone,
          email: stores.email,
          address: stores.address,
          country: stores.country,
          status: stores.status,
          created_at: stores.createdAt,
          last_seen_at:
            sql<Date | null>`(select max(greatest(last_heartbeat_at, last_licence_at)) from pos_devices where store_id = "stores"."id")`.mapWith(
              posDevices.lastHeartbeatAt,
            ),
          app_version: sql<
            string | null
          >`(select app_version from pos_devices where store_id = "stores"."id" order by greatest(last_heartbeat_at, last_licence_at) desc nulls last limit 1)`,
          licence_status: sql<
            string | null
          >`(select status from subscriptions where store_id = "stores"."id" order by created_at desc limit 1)`,
          licence_ends_at:
            sql<Date | null>`(select coalesce(current_period_end, trial_ends_at) from subscriptions where store_id = "stores"."id" order by created_at desc limit 1)`.mapWith(
              subscriptions.trialEndsAt,
            ),
        })
        .from(stores)
        .where(cond)
        .orderBy(desc(stores.createdAt))
        .limit(page.perPage)
        .offset(offset(page)),
      this.db.select({ n: count() }).from(stores).where(cond),
    ]);
    const onlineSince = Date.now() - ONLINE_MINUTES * 60_000;
    return {
      data: rows.map((r) => ({
        ...r,
        online: r.last_seen_at ? new Date(r.last_seen_at).getTime() >= onlineSince : false,
      })),
      total: total[0]?.n ?? 0,
      page: page.page,
      per_page: page.perPage,
    };
  }

  async storeDetail(storeId: string) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store) throw new NotFoundException({ error: 'store_not_found' });
    const since = new Date(Date.now() - 14 * DAY_MS).toISOString().slice(0, 10);
    const now = new Date();
    const windowStart = new Date(now.getTime() - ONLINE_HISTORY_DAYS * DAY_MS);
    const [
      devices,
      licenceHistory,
      payments,
      tickets,
      stats,
      members,
      onlinePeriods,
      onlineTotals,
      backups,
      activity,
      blocks,
    ] = await Promise.all([
      this.db
        .select({
          id: posDevices.id,
          device_name: posDevices.deviceName,
          platform: posDevices.platform,
          app_version: posDevices.appVersion,
          last_ip: posDevices.lastIp,
          last_heartbeat_at: posDevices.lastHeartbeatAt,
          last_seen_at: deviceLastSeen,
          active_orders: posDevices.activeOrders,
          machine_bound: sql<boolean>`${posDevices.machineIdHash} is not null`,
          last_licence_at: posDevices.lastLicenceAt,
          revoked_at: posDevices.revokedAt,
          created_at: posDevices.createdAt,
        })
        .from(posDevices)
        .where(eq(posDevices.storeId, storeId))
        .orderBy(sql`${deviceLastSeen} desc nulls last`),
      this.db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          plan_code: plans.code,
          plan_name: plans.name,
          trial_ends_at: subscriptions.trialEndsAt,
          current_period_start: subscriptions.currentPeriodStart,
          current_period_end: subscriptions.currentPeriodEnd,
          grace_waived: subscriptions.graceWaived,
          notes: subscriptions.notes,
          created_at: subscriptions.createdAt,
        })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.storeId, storeId))
        .orderBy(desc(subscriptions.createdAt)),
      this.db
        .select({
          id: subscriptionPayments.id,
          amount: subscriptionPayments.amount,
          currency: subscriptionPayments.currency,
          method: subscriptionPayments.method,
          status: subscriptionPayments.status,
          paid_at: subscriptionPayments.paidAt,
        })
        .from(subscriptionPayments)
        .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPayments.subscriptionId))
        .where(eq(subscriptions.storeId, storeId))
        .orderBy(desc(subscriptionPayments.paidAt)),
      this.db
        .select({
          id: supportTickets.id,
          support_code: supportTickets.supportCode,
          category: supportTickets.category,
          status: supportTickets.status,
          message: supportTickets.message,
          created_at: supportTickets.createdAt,
        })
        .from(supportTickets)
        .where(eq(supportTickets.storeId, storeId))
        .orderBy(desc(supportTickets.createdAt))
        .limit(10),
      this.db
        .select({
          business_date: dailyStoreStats.businessDate,
          gross_sales: dailyStoreStats.grossSales,
          bills_count: dailyStoreStats.billsCount,
          orders_count: dailyStoreStats.ordersCount,
        })
        .from(dailyStoreStats)
        .where(and(eq(dailyStoreStats.storeId, storeId), gte(dailyStoreStats.businessDate, since)))
        .orderBy(asc(dailyStoreStats.businessDate)),
      this.db
        .select({
          owner_id: owners.id,
          name: owners.name,
          email: owners.email,
          phone: owners.phoneE164,
          invited: sql<boolean>`${owners.passwordHash} is null`,
          role: storeMembers.role,
          since: storeMembers.createdAt,
        })
        .from(storeMembers)
        .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
        .where(eq(storeMembers.storeId, storeId)),
      this.db
        .select({
          device_id: posPresence.deviceId,
          started_at: posPresence.startedAt,
          last_seen_at: posPresence.lastSeenAt,
        })
        .from(posPresence)
        .where(and(eq(posPresence.storeId, storeId), gte(posPresence.lastSeenAt, windowStart)))
        .orderBy(desc(posPresence.startedAt))
        .limit(ONLINE_PERIODS_SHOWN),
      this.db
        .select({
          device_id: posPresence.deviceId,
          online_seconds: sql<number>`coalesce(sum(extract(epoch from
            least(${posPresence.lastSeenAt}, ${now.toISOString()}::timestamptz)
            - greatest(${posPresence.startedAt}, ${windowStart.toISOString()}::timestamptz))), 0)::float8`,
          first_started_at: sql<Date>`min(${posPresence.startedAt})`.mapWith(posPresence.startedAt),
        })
        .from(posPresence)
        .where(eq(posPresence.storeId, storeId))
        .groupBy(posPresence.deviceId),
      this.db
        .select({
          id: posBackups.id,
          device_id: posBackups.deviceId,
          destination: posBackups.destination,
          status: posBackups.status,
          file_name: posBackups.fileName,
          size_bytes: posBackups.sizeBytes,
          error: posBackups.error,
          occurred_at: posBackups.occurredAt,
        })
        .from(posBackups)
        .where(eq(posBackups.storeId, storeId))
        .orderBy(desc(posBackups.occurredAt))
        .limit(BACKUPS_SHOWN),
      this.db
        .select({
          id: adminAuditLog.id,
          action: adminAuditLog.action,
          admin_name: admins.name,
          details: adminAuditLog.details,
          created_at: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .leftJoin(admins, eq(admins.id, adminAuditLog.adminId))
        .where(
          or(
            and(eq(adminAuditLog.targetType, 'store'), eq(adminAuditLog.targetId, storeId)),
            sql`${adminAuditLog.details}->>'store_id' = ${storeId}`,
          ),
        )
        .orderBy(desc(adminAuditLog.id))
        .limit(ACTIVITY_SHOWN),
      this.db
        .select({
          id: storeBlocks.id,
          reason: storeBlocks.reason,
          blocked_at: storeBlocks.blockedAt,
          lifted_at: storeBlocks.liftedAt,
        })
        .from(storeBlocks)
        .where(eq(storeBlocks.storeId, storeId))
        .orderBy(desc(storeBlocks.blockedAt)),
    ]);
    const onlineSince = now.getTime() - ONLINE_MINUTES * 60_000;
    const totals = new Map(onlineTotals.map((t) => [t.device_id, t]));
    return {
      store,
      devices: devices.map((d) => ({
        ...d,
        online: !!d.last_seen_at && new Date(d.last_seen_at).getTime() >= onlineSince,
      })),
      licence_history: licenceHistory,
      payments,
      tickets,
      stats,
      members,
      online_history: {
        window_days: ONLINE_HISTORY_DAYS,
        devices: devices.map((d) => {
          const t = totals.get(d.id);
          // Count from when recording began for this device, so new history isn't read as downtime.
          const from = Math.max(
            windowStart.getTime(),
            t ? t.first_started_at.getTime() : now.getTime(),
          );
          const windowSeconds = Math.max(0, (now.getTime() - from) / 1000);
          const onlineSeconds = Math.min(t?.online_seconds ?? 0, windowSeconds);
          return {
            device_id: d.id,
            recorded_since: t?.first_started_at ?? null,
            online_seconds: Math.round(onlineSeconds),
            uptime_pct:
              windowSeconds >= 60 ? Math.round((onlineSeconds / windowSeconds) * 1000) / 10 : null,
          };
        }),
        periods: onlinePeriods,
      },
      backups: {
        last_success_at: backups.find((b) => b.status === 'success')?.occurred_at ?? null,
        recent: backups,
      },
      activity,
      block: store.status === 'suspended' ? (blocks.find((b) => !b.lifted_at) ?? null) : null,
      block_history: blocks,
    };
  }

  /** Blocks or unblocks the store's cloud access and, when asked, emails its owners and managers. */
  async changeStoreStatus(
    storeId: string,
    input: StoreStatusInput,
    admin: AdminRow,
    ip: string | null,
  ) {
    const block = input.action === 'block';
    const reason = block ? input.reason.trim() : null;
    const store = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(stores).where(eq(stores.id, storeId)).for('update');
      if (!current || current.status === 'deleted') {
        throw new NotFoundException({ error: 'store_not_found' });
      }
      if (block === (current.status === 'suspended')) {
        throw new ConflictException({
          error: block ? 'store_already_blocked' : 'store_not_blocked',
        });
      }
      const now = new Date();
      await tx
        .update(stores)
        .set({ status: block ? 'suspended' : 'active' })
        .where(eq(stores.id, storeId));
      if (block) {
        await tx
          .insert(storeBlocks)
          .values({ storeId, reason: reason!, blockedAt: now, blockedByAdmin: admin.id });
      } else {
        await tx
          .update(storeBlocks)
          .set({ liftedAt: now, liftedByAdmin: admin.id })
          .where(and(eq(storeBlocks.storeId, storeId), isNull(storeBlocks.liftedAt)));
      }
      await writeAudit(tx, {
        adminId: admin.id,
        action: block ? 'store.block' : 'store.unblock',
        targetType: 'store',
        targetId: storeId,
        details: { reason, notify_owners: input.notify_owners },
        ip,
      });
      return current;
    });

    let notified = 0;
    if (input.notify_owners) {
      const recipients = await this.db
        .select({ email: owners.email })
        .from(storeMembers)
        .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
        .where(and(eq(storeMembers.storeId, storeId), eq(owners.status, 'active')));
      const name = store.name || 'Your café';
      for (const { email } of recipients) {
        this.email.queue(
          block
            ? ownerEmails.storeBlocked(email, name, reason!)
            : ownerEmails.storeUnblocked(email, name),
        );
        notified++;
      }
    }
    return { status: block ? 'blocked' : 'active', reason, notified };
  }

  /** Plans with how many stores are on each now; without includeInactive, only plans on sale. */
  async listPlans(includeInactive = false) {
    const rows = await this.db
      .select({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        price: plans.price,
        currency: plans.currency,
        interval: plans.interval,
        max_devices: plans.maxDevices,
        features: plans.features,
        is_active: plans.isActive,
        created_at: plans.createdAt,
        active_stores: sql<number>`(select count(*)::int from subscriptions s
          where s.plan_id = "plans"."id" and s.status in ('active', 'past_due'))`,
      })
      .from(plans)
      .where(includeInactive ? undefined : eq(plans.isActive, true))
      .orderBy(desc(plans.isActive), asc(plans.price));
    return rows;
  }

  async createPlan(input: PlanInput, admin: AdminRow, ip: string | null) {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(plans)
          .values({
            code: input.code,
            name: input.name,
            price: input.price,
            currency: input.currency,
            interval: input.interval,
            maxDevices: input.max_devices,
            features: input.features ?? {},
          })
          .returning();
        await writeAudit(tx, {
          adminId: admin.id,
          action: 'plan.create',
          targetType: 'plan',
          targetId: row.id,
          details: { ...input },
          ip,
        });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'plan_code_in_use' });
      throw err;
    }
  }

  /**
   * Code, currency and billing period are fixed once a plan exists, because licences refer to them.
   * A new price applies to activations and renewals from now on, never to licences already paid.
   */
  async updatePlan(id: string, input: PlanUpdate, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const before = await tx.query.plans.findFirst({ where: eq(plans.id, id) });
      if (!before) throw new NotFoundException({ error: 'plan_not_found' });
      const [row] = await tx
        .update(plans)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.price !== undefined && { price: input.price }),
          ...(input.max_devices !== undefined && { maxDevices: input.max_devices }),
          ...(input.is_active !== undefined && { isActive: input.is_active }),
          ...(input.features !== undefined && { features: input.features }),
        })
        .where(eq(plans.id, id))
        .returning();
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'plan.update',
        targetType: 'plan',
        targetId: id,
        details: {
          changes: input,
          before: {
            name: before.name,
            price: before.price,
            max_devices: before.maxDevices,
            is_active: before.isActive,
          },
        },
        ip,
      });
      return row;
    });
  }

  /**
   * Changes a store's licence. The heartbeat then turns cloud orders and reports on or off, and
   * each POS is told to fetch its licence at once.
   */
  async changeLicence(storeId: string, input: LicenceAction, admin: AdminRow, ip: string | null) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store) throw new NotFoundException({ error: 'store_not_found' });
    const now = new Date();

    const result = await this.db.transaction(async (tx) => {
      const current = await tx.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.storeId, storeId),
          inArray(subscriptions.status, [...CURRENT_SUBSCRIPTION_STATUSES]),
        ),
      });
      let result: Record<string, unknown>;

      if (input.action === 'extend_trial') {
        if (current && current.status !== 'trial')
          throw new ConflictException({ error: 'store_has_paid_licence' });
        const base = current?.trialEndsAt && current.trialEndsAt > now ? current.trialEndsAt : now;
        const trialEndsAt = new Date(base.getTime() + input.days * DAY_MS);
        if (current) {
          await tx
            .update(subscriptions)
            .set({ trialEndsAt, updatedAt: now })
            .where(eq(subscriptions.id, current.id));
        } else {
          await tx.insert(subscriptions).values({
            storeId,
            status: 'trial',
            trialEndsAt,
            createdByAdmin: admin.id,
            notes: input.note ?? null,
          });
        }
        result = { status: 'trial', trial_ends_at: trialEndsAt };
      } else if (input.action === 'activate') {
        const plan = await tx.query.plans.findFirst({
          where: and(eq(plans.code, input.plan_code), eq(plans.isActive, true)),
        });
        if (!plan) throw new BadRequestException({ error: 'unknown_plan' });
        // A renewal while active starts from the current end date, so paid days are never lost.
        const start =
          current?.status === 'active' && current.currentPeriodEnd && current.currentPeriodEnd > now
            ? current.currentPeriodEnd
            : now;
        const end = new Date(start);
        if (plan.interval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
        else end.setUTCMonth(end.getUTCMonth() + 1);
        if (current) {
          await tx
            .update(subscriptions)
            .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
            .where(eq(subscriptions.id, current.id));
        }
        const [sub] = await tx
          .insert(subscriptions)
          .values({
            storeId,
            planId: plan.id,
            status: 'active',
            currentPeriodStart: start,
            currentPeriodEnd: end,
            notes: input.note ?? null,
            createdByAdmin: admin.id,
          })
          .returning({ id: subscriptions.id });
        if (input.amount !== undefined) {
          await tx.insert(subscriptionPayments).values({
            subscriptionId: sub.id,
            amount: input.amount,
            currency: plan.currency,
            method: 'manual',
            recordedByAdmin: admin.id,
            paidAt: now,
          });
        }
        result = { status: 'active', plan: plan.code, current_period_end: end };
      } else {
        // An already suspended licence can still lose its grace period.
        const latest = current
          ? undefined
          : await tx.query.subscriptions.findFirst({
              where: eq(subscriptions.storeId, storeId),
              orderBy: [desc(subscriptions.createdAt)],
            });
        const target =
          current ?? (input.immediate && latest?.status === 'suspended' ? latest : undefined);
        if (!target) throw new ConflictException({ error: 'no_current_licence' });
        const graceWaived = !!input.immediate || target.graceWaived;
        await tx
          .update(subscriptions)
          .set({
            status: 'suspended',
            graceWaived,
            notes: input.note ?? target.notes,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, target.id));
        result = { status: 'suspended', grace_waived: graceWaived };
      }

      await writeAudit(tx, {
        adminId: admin.id,
        action: `licence.${input.action}`,
        targetType: 'store',
        targetId: storeId,
        details: { ...input, result },
        ip,
      });
      return result;
    });
    // Best effort: a POS that misses this still learns at its next licence check-in.
    await this.commands.requestLicenceRefresh(storeId, admin.id).catch(() => undefined);
    return result;
  }

  async listTickets(status: string | undefined, page: Page) {
    const cond = status ? eq(supportTickets.status, status) : undefined;
    const [rows, total] = await Promise.all([
      this.db
        .select({
          id: supportTickets.id,
          support_code: supportTickets.supportCode,
          store_id: supportTickets.storeId,
          store_name: stores.name,
          category: supportTickets.category,
          subject: sql<string | null>`${supportTickets.context}->>'subject'`,
          status: supportTickets.status,
          assigned_admin_id: supportTickets.assignedAdminId,
          created_at: supportTickets.createdAt,
          updated_at: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .innerJoin(stores, eq(stores.id, supportTickets.storeId))
        .where(cond)
        .orderBy(desc(supportTickets.createdAt))
        .limit(page.perPage)
        .offset(offset(page)),
      this.db.select({ n: count() }).from(supportTickets).where(cond),
    ]);
    return { data: rows, total: total[0]?.n ?? 0, page: page.page, per_page: page.perPage };
  }

  async ticketDetail(id: string) {
    const ticket = await this.db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, id),
    });
    if (!ticket) throw new NotFoundException({ error: 'ticket_not_found' });
    const [store, notes] = await Promise.all([
      this.db.query.stores.findFirst({ where: eq(stores.id, ticket.storeId) }),
      this.db
        .select({
          id: supportTicketNotes.id,
          body: supportTicketNotes.body,
          admin_name: admins.name,
          created_at: supportTicketNotes.createdAt,
        })
        .from(supportTicketNotes)
        .leftJoin(admins, eq(admins.id, supportTicketNotes.adminId))
        .where(eq(supportTicketNotes.ticketId, id))
        .orderBy(asc(supportTicketNotes.createdAt)),
    ]);
    return {
      ticket,
      store: store ? { id: store.id, name: store.name, phone: store.phone } : null,
      notes,
    };
  }

  async updateTicket(
    id: string,
    input: { status?: TicketStatus; assigned_admin_id?: string | null },
    admin: AdminRow,
    ip: string | null,
  ) {
    return this.db.transaction(async (tx) => {
      const ticket = await tx.query.supportTickets.findFirst({ where: eq(supportTickets.id, id) });
      if (!ticket) throw new NotFoundException({ error: 'ticket_not_found' });
      const now = new Date();
      await tx
        .update(supportTickets)
        .set({
          ...(input.status
            ? { status: input.status, resolvedAt: input.status === 'resolved' ? now : null }
            : {}),
          ...(input.assigned_admin_id !== undefined
            ? { assignedAdminId: input.assigned_admin_id }
            : {}),
          updatedAt: now,
        })
        .where(eq(supportTickets.id, id));
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'ticket.update',
        targetType: 'ticket',
        targetId: id,
        details: input,
        ip,
      });
      return { ok: true };
    });
  }

  async addTicketNote(id: string, body: string, admin: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const ticket = await tx.query.supportTickets.findFirst({ where: eq(supportTickets.id, id) });
      if (!ticket) throw new NotFoundException({ error: 'ticket_not_found' });
      const [note] = await tx
        .insert(supportTicketNotes)
        .values({ ticketId: id, adminId: admin.id, body })
        .returning();
      await tx
        .update(supportTickets)
        .set({ updatedAt: new Date() })
        .where(eq(supportTickets.id, id));
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'ticket.note',
        targetType: 'ticket',
        targetId: id,
        ip,
      });
      return note;
    });
  }

  async listAdmins() {
    const rows = await this.db.select().from(admins).orderBy(asc(admins.createdAt));
    return rows.map((a) => ({
      ...toPublic(a),
      status: a.status,
      two_factor: Boolean(a.totpSecretEnc),
      last_login_at: a.lastLoginAt,
      created_at: a.createdAt,
    }));
  }

  async createAdmin(
    input: { name: string; email: string; role: AdminRole; password: string },
    by: AdminRow,
    ip: string | null,
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(admins)
          .values({
            name: input.name,
            email: input.email,
            role: input.role,
            passwordHash: await this.crypto.hashPassword(input.password),
          })
          .returning();
        await writeAudit(tx, {
          adminId: by.id,
          action: 'admin.create',
          targetType: 'admin',
          targetId: row.id,
          details: { email: input.email, role: input.role },
          ip,
        });
        return toPublic(row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ error: 'email_in_use' });
      throw err;
    }
  }

  async setAdminStatus(id: string, status: 'active' | 'disabled', by: AdminRow, ip: string | null) {
    if (id === by.id) throw new BadRequestException({ error: 'cannot_change_own_status' });
    return this.updateAdmin(
      id,
      { status },
      `admin.${status === 'active' ? 'enable' : 'disable'}`,
      by,
      ip,
      status === 'disabled',
    );
  }

  /** Lets the device check in from a different computer (new PC, reinstalled Windows). */
  async resetDeviceBinding(storeId: string, deviceId: string, by: AdminRow, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(posDevices)
        .set({ machineIdHash: null })
        .where(and(eq(posDevices.id, deviceId), eq(posDevices.storeId, storeId)))
        .returning({ id: posDevices.id });
      if (!row) throw new NotFoundException({ error: 'device_not_found' });
      await writeAudit(tx, {
        adminId: by.id,
        action: 'device.reset_binding',
        targetType: 'device',
        targetId: deviceId,
        details: { store_id: storeId },
        ip,
      });
      return { ok: true };
    });
  }

  async resetTwoFactor(id: string, by: AdminRow, ip: string | null) {
    return this.updateAdmin(
      id,
      { totpSecretEnc: null, totpLastStep: null },
      'admin.reset_2fa',
      by,
      ip,
      true,
    );
  }

  private async updateAdmin(
    id: string,
    set: Partial<typeof admins.$inferInsert>,
    action: string,
    by: AdminRow,
    ip: string | null,
    endSessions: boolean,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(admins).set(set).where(eq(admins.id, id)).returning();
      if (!row) throw new NotFoundException({ error: 'admin_not_found' });
      if (endSessions) {
        await tx.execute(
          sql`update admin_sessions set revoked_at = now() where admin_id = ${id} and revoked_at is null`,
        );
      }
      await writeAudit(tx, { adminId: by.id, action, targetType: 'admin', targetId: id, ip });
      return toPublic(row);
    });
  }

  async auditLog(filters: { action?: string; target_id?: string }, page: Page) {
    const where: SQL[] = [];
    if (filters.action) where.push(eq(adminAuditLog.action, filters.action));
    if (filters.target_id) where.push(eq(adminAuditLog.targetId, filters.target_id));
    const cond = where.length ? and(...where) : undefined;
    const [rows, total, actions] = await Promise.all([
      this.db
        .select({
          id: adminAuditLog.id,
          action: adminAuditLog.action,
          admin_name: admins.name,
          admin_email: admins.email,
          target_type: adminAuditLog.targetType,
          target_id: adminAuditLog.targetId,
          details: adminAuditLog.details,
          ip: adminAuditLog.ip,
          created_at: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .leftJoin(admins, eq(admins.id, adminAuditLog.adminId))
        .where(cond)
        .orderBy(desc(adminAuditLog.id))
        .limit(page.perPage)
        .offset(offset(page)),
      this.db.select({ n: count() }).from(adminAuditLog).where(cond),
      this.db.selectDistinct({ action: adminAuditLog.action }).from(adminAuditLog),
    ]);
    return {
      data: rows,
      total: total[0]?.n ?? 0,
      page: page.page,
      per_page: page.perPage,
      actions: actions.map((a) => a.action).sort(),
    };
  }
}
