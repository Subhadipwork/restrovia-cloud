import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  type AdminRole,
  type TicketStatus,
} from '@restrovia/shared';
import { CryptoService } from '../crypto/crypto.service.js';
import { DB, type Database } from '../db/database.module.js';
import {
  adminAuditLog,
  admins,
  dailyStoreStats,
  owners,
  plans,
  posDevices,
  storeMembers,
  stores,
  subscriptionPayments,
  subscriptions,
  supportTicketNotes,
  supportTickets,
} from '../db/schema/index.js';
import { isUniqueViolation } from '../pos/register.service.js';
import type { AdminRow } from './admin-auth.service.js';
import { toPublic } from './admin-auth.service.js';
import { writeAudit } from './audit.js';

const ONLINE_MINUTES = 10;
const DAY_MS = 86_400_000;

export type LicenceAction =
  | { action: 'extend_trial'; days: number; note?: string }
  | { action: 'activate'; plan_code: string; amount?: string; note?: string }
  | { action: 'suspend'; note?: string };

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
const offset = (p: Page) => (p.page - 1) * p.perPage;

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
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
        .where(gte(posDevices.lastHeartbeatAt, onlineSince)),
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
      where.push(
        or(
          ilike(stores.name, term),
          ilike(stores.phone, term),
          ilike(sql`${stores.email}::text`, term),
          ilike(stores.address, term),
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
          last_seen_at: sql<Date | null>`(select max(last_heartbeat_at) from pos_devices where store_id = "stores"."id")`,
          app_version: sql<
            string | null
          >`(select app_version from pos_devices where store_id = "stores"."id" order by last_heartbeat_at desc nulls last limit 1)`,
          licence_status: sql<
            string | null
          >`(select status from subscriptions where store_id = "stores"."id" order by created_at desc limit 1)`,
          licence_ends_at: sql<Date | null>`(select coalesce(current_period_end, trial_ends_at) from subscriptions where store_id = "stores"."id" order by created_at desc limit 1)`,
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
    const [devices, licenceHistory, payments, tickets, stats, members] = await Promise.all([
      this.db
        .select({
          id: posDevices.id,
          device_name: posDevices.deviceName,
          platform: posDevices.platform,
          app_version: posDevices.appVersion,
          last_heartbeat_at: posDevices.lastHeartbeatAt,
          active_orders: posDevices.activeOrders,
          machine_bound: sql<boolean>`${posDevices.machineIdHash} is not null`,
          last_licence_at: posDevices.lastLicenceAt,
          revoked_at: posDevices.revokedAt,
          created_at: posDevices.createdAt,
        })
        .from(posDevices)
        .where(eq(posDevices.storeId, storeId))
        .orderBy(desc(posDevices.lastHeartbeatAt)),
      this.db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          plan_code: plans.code,
          plan_name: plans.name,
          trial_ends_at: subscriptions.trialEndsAt,
          current_period_start: subscriptions.currentPeriodStart,
          current_period_end: subscriptions.currentPeriodEnd,
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
          phone: owners.phoneE164,
          role: storeMembers.role,
          since: storeMembers.createdAt,
        })
        .from(storeMembers)
        .innerJoin(owners, eq(owners.id, storeMembers.ownerId))
        .where(eq(storeMembers.storeId, storeId)),
    ]);
    const onlineSince = Date.now() - ONLINE_MINUTES * 60_000;
    return {
      store,
      devices: devices.map((d) => ({
        ...d,
        online: !!d.last_heartbeat_at && d.last_heartbeat_at.getTime() >= onlineSince,
      })),
      licence_history: licenceHistory,
      payments,
      tickets,
      stats,
      members,
    };
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

  /** Changes a store's licence; the heartbeat then turns cloud orders and reports on or off. */
  async changeLicence(storeId: string, input: LicenceAction, admin: AdminRow, ip: string | null) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store) throw new NotFoundException({ error: 'store_not_found' });
    const now = new Date();

    return this.db.transaction(async (tx) => {
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
        if (!current) throw new ConflictException({ error: 'no_current_licence' });
        await tx
          .update(subscriptions)
          .set({ status: 'suspended', notes: input.note ?? current.notes, updatedAt: now })
          .where(eq(subscriptions.id, current.id));
        result = { status: 'suspended' };
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
