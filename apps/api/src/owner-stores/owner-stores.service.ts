import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import {
  dailyStoreStats,
  orderBills,
  orderItems,
  orders,
  plans,
  posDevices,
  storeMembers,
  stores,
  syncEvents,
} from '../db/schema/index.js';
import { mapOrderSnapshot } from '../ingest/order-snapshot.js';
import { CommandsService } from '../commands/commands.service.js';
import { deviceLastSeen, isOnline } from '../pos/device-status.js';
import { LicensingService } from '../pos/licensing.service.js';
import { PosRelayService } from '../pos/relay.service.js';
import { businessDate } from '../sales/business-date.js';
import type { StoreMemberRole } from '@restrovia/shared';
import type { StoreRow } from './store-member.guard.js';

/** The statuses the POS lists as open (liveOrders in the POS cloud-sync service). */
export const OPEN_ORDER_STATUSES = ['pending', 'preparing', 'ready', 'served'];
const openStatusList = sql.join(
  OPEN_ORDER_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);

const LIVE_WAIT_MS = 8_000;
const LIVE_CACHE_MS = 10_000;
const LIVE_LIMIT = 200;
export const MAX_RANGE_DAYS = 92;
export const ORDERS_PAGE_SIZE = 25;

export type OrderFilters = {
  from?: string;
  to?: string;
  type?: string;
  status?: 'open' | 'completed' | 'cancelled';
  q?: string;
  page: number;
};

type DayTotals = {
  gross_sales: string;
  net_sales: string;
  orders_count: number;
  bills_count: number;
  cancelled_count: number;
  avg_bill: string;
};

type LiveItem = {
  name: string;
  quantity: string;
  total: string;
  status: string | null;
  voided: boolean;
};
export type LiveOrder = {
  order_id: string | null;
  pos_order_id: number;
  order_number: string | null;
  type: string | null;
  online_platform: string | null;
  status: string | null;
  table: string | null;
  guests: number | null;
  total: string;
  paid: string;
  payment_status: string | null;
  created_at: string;
  items: LiveItem[];
};
export type LiveResult = {
  source: 'live' | 'synced';
  /** Why the answer is synced data: the POS is offline, didn't answer in time, or the licence ended. */
  reason: 'offline' | 'no_answer' | 'licence_inactive' | null;
  as_of: string | null;
  orders: LiveOrder[];
};

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const emptyTotals = (): DayTotals => ({
  gross_sales: '0.00',
  net_sales: '0.00',
  orders_count: 0,
  bills_count: 0,
  cancelled_count: 0,
  avg_bill: '0.00',
});

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The store code Restrovia POS shows in Settings → About: first 8 characters of the id, upper case. */
export const storeCode = (storeId: string) => storeId.replace(/-/g, '').slice(0, 8).toUpperCase();

/** What an owner sees of their stores: status, today's sales, open orders and order history. */
@Injectable()
export class OwnerStoresService {
  /** One live answer per store, shared by every viewer for a few seconds. */
  private readonly liveCache = new Map<string, { at: number; result: Promise<LiveResult> }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
    private readonly relay: PosRelayService,
    private readonly licensing: LicensingService,
  ) {}

  today(store: StoreRow, now = new Date()): string {
    return businessDate(now, store.timezone, store.businessDayStart);
  }

  async list(ownerId: string) {
    const rows = await this.db
      .select({
        store: stores,
        role: storeMembers.role,
        lastSeen: sql<Date | null>`(select max(greatest(last_heartbeat_at, last_licence_at))
          from pos_devices where store_id = "stores"."id" and revoked_at is null)`,
        openOrders: sql<number>`(select count(*)::int from orders
          where store_id = "stores"."id" and status in (${openStatusList}))`,
      })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .where(and(eq(storeMembers.ownerId, ownerId), ne(stores.status, 'deleted')))
      .orderBy(asc(stores.name));

    const result = [];
    for (const row of rows) {
      const today = this.today(row.store);
      const [stats, licence] = await Promise.all([
        this.statsFor(row.store.id, [today]),
        this.licensing.stateFor(row.store.id),
      ]);
      const totals = stats.totals.get(today) ?? emptyTotals();
      result.push({
        ...this.storeHeader(row.store, row.lastSeen),
        role: row.role,
        open_orders: row.openOrders,
        today: {
          business_date: today,
          gross_sales: totals.gross_sales,
          bills_count: totals.bills_count,
        },
        licence: { status: licence.status, ends_at: licence.endsAt.toISOString() },
      });
    }
    return { stores: result };
  }

  /** Everything about the café the owner may need, for example when talking to Restrovia support. */
  async details(store: StoreRow, role: StoreMemberRole) {
    const [status, licence] = await Promise.all([
      this.status(store),
      this.licensing.stateFor(store.id),
    ]);
    const plan = licence.plan
      ? await this.db.query.plans.findFirst({ where: eq(plans.code, licence.plan) })
      : null;
    return {
      ...status,
      code: storeCode(store.id),
      role,
      contact_name: store.contactName,
      email: store.email,
      phone: store.phone,
      address: store.address,
      country: store.country,
      store_type: store.storeType,
      store_status: store.status,
      created_at: iso(store.createdAt),
      licence: {
        status: licence.status,
        plan_code: licence.plan,
        plan_name: plan?.name ?? null,
        ends_at: licence.endsAt.toISOString(),
        grace_ends_at: licence.graceEndsAt.toISOString(),
      },
    };
  }

  async status(store: StoreRow) {
    const [devices, [synced]] = await Promise.all([
      this.db
        .select({
          id: posDevices.id,
          name: posDevices.deviceName,
          platform: posDevices.platform,
          appVersion: posDevices.appVersion,
          lastSeen: deviceLastSeen,
          lastHeartbeat: posDevices.lastHeartbeatAt,
          activeOrders: posDevices.activeOrders,
        })
        .from(posDevices)
        .where(and(eq(posDevices.storeId, store.id), isNull(posDevices.revokedAt)))
        .orderBy(sql`${deviceLastSeen} desc nulls last`),
      this.db
        .select({ at: max(orders.syncedAt) })
        .from(orders)
        .where(eq(orders.storeId, store.id)),
    ]);
    const lastSeen = devices.find((d) => d.lastSeen)?.lastSeen ?? null;
    return {
      ...this.storeHeader(store, lastSeen),
      last_order_synced_at: iso(synced?.at),
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        app_version: d.appVersion,
        online: isOnline(d.lastSeen),
        last_seen_at: iso(d.lastSeen),
        last_heartbeat_at: iso(d.lastHeartbeat),
        live_connection: this.relay.isConnected(d.id),
        open_orders: d.activeOrders,
      })),
    };
  }

  async dashboard(store: StoreRow, date?: string) {
    const now = new Date();
    const today = this.today(store, now);
    const day = date ?? today;
    if (day > today) throw new BadRequestException({ error: 'future_date' });
    const yesterday = addDays(day, -1);
    const lastWeek = addDays(day, -7);
    const isToday = day === today;

    const [stats, lastSeenRow, [openRow], [eventRow], licence] = await Promise.all([
      this.statsFor(store.id, [day, yesterday, lastWeek], true),
      this.db
        .select({ at: sql<Date | null>`max(${deviceLastSeen})` })
        .from(posDevices)
        .where(and(eq(posDevices.storeId, store.id), isNull(posDevices.revokedAt))),
      this.db
        .select({ n: count() })
        .from(orders)
        .where(and(eq(orders.storeId, store.id), sql`${orders.status} in (${openStatusList})`)),
      this.db
        .select({ at: max(syncEvents.receivedAt) })
        .from(syncEvents)
        .where(eq(syncEvents.storeId, store.id)),
      this.licensing.stateFor(store.id),
    ]);
    const lastSeen = lastSeenRow[0]?.at ?? null;
    const main = stats.totals.get(day) ?? emptyTotals();
    // Today is still running, so compare with the earlier days up to the same time of day.
    const compare = isToday
      ? await Promise.all([
          this.sameTimeTotals(store, yesterday, today, now),
          this.sameTimeTotals(store, lastWeek, today, now),
        ])
      : [stats.totals.get(yesterday) ?? emptyTotals(), stats.totals.get(lastWeek) ?? emptyTotals()];

    // by_hour is indexed by clock hour; the chart starts at the business day start.
    const startHour = Number(store.businessDayStart.slice(0, 2)) || 0;
    const dayHours = stats.hours.get(day) ?? [];
    const weekHours = stats.hours.get(lastWeek) ?? [];
    const dataAsOf = [eventRow?.at, lastSeen]
      .filter((d): d is Date => !!d)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

    return {
      store: this.storeHeader(store, lastSeen),
      business_date: day,
      is_today: isToday,
      totals: main,
      compare: {
        yesterday: { business_date: yesterday, same_time: isToday, ...compare[0] },
        last_week: { business_date: lastWeek, same_time: isToday, ...compare[1] },
      },
      by_type: stats.types.get(day) ?? {},
      hourly: Array.from({ length: 24 }, (_, i) => {
        const hour = (startHour + i) % 24;
        return { hour, sales: dayHours[hour] ?? '0.00', last_week: weekHours[hour] ?? '0.00' };
      }),
      open_orders: openRow?.n ?? 0,
      data_as_of: iso(dataAsOf),
      licence: { status: licence.status, ends_at: licence.endsAt.toISOString() },
    };
  }

  async live(store: StoreRow, ownerId: string): Promise<LiveResult> {
    const cached = this.liveCache.get(store.id);
    if (cached && Date.now() - cached.at < LIVE_CACHE_MS) return cached.result;
    const result = this.fetchLive(store, ownerId);
    this.liveCache.set(store.id, { at: Date.now(), result });
    result.catch(() => this.liveCache.delete(store.id));
    return result;
  }

  async orders(store: StoreRow, f: OrderFilters) {
    const from = f.from ?? f.to ?? this.today(store);
    const to = f.to ?? from;
    if (from > to) throw new BadRequestException({ error: 'invalid_range' });
    if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
      throw new BadRequestException({ error: 'range_too_long', max_days: MAX_RANGE_DAYS });
    }
    const where: SQL[] = [
      eq(orders.storeId, store.id),
      gte(orders.businessDate, from),
      lte(orders.businessDate, to),
    ];
    if (f.type) where.push(eq(orders.type, f.type));
    if (f.status === 'open') where.push(sql`${orders.status} in (${openStatusList})`);
    if (f.status === 'completed') where.push(eq(orders.status, 'completed'));
    if (f.status === 'cancelled') where.push(eq(orders.status, 'cancelled'));
    if (f.q) {
      const term = `${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      where.push(or(ilike(orders.orderNumber, term), ilike(orders.tableName, term))!);
    }
    const cond = and(...where);
    const rangeCond = and(
      eq(orders.storeId, store.id),
      gte(orders.businessDate, from),
      lte(orders.businessDate, to),
    );

    const [rows, [totals], types] = await Promise.all([
      this.db
        .select({
          id: orders.id,
          posOrderId: orders.posOrderId,
          orderNumber: orders.orderNumber,
          type: orders.type,
          onlinePlatform: orders.onlinePlatform,
          status: orders.status,
          tableName: orders.tableName,
          total: orders.total,
          paid: orders.paidAmount,
          paymentStatus: orders.paymentStatus,
          createdAt: orders.posCreatedAt,
          businessDate: orders.businessDate,
          itemsCount: sql<number>`(select count(*)::int from order_items i
            where i.order_id = "orders"."id" and i.voided_at is null)`,
        })
        .from(orders)
        .where(cond)
        .orderBy(desc(orders.posCreatedAt), desc(orders.posOrderId))
        .limit(ORDERS_PAGE_SIZE)
        .offset((f.page - 1) * ORDERS_PAGE_SIZE),
      this.db
        .select({
          orders: count(),
          gross: sql<string>`coalesce(sum(${orders.total}) filter (where coalesce(${orders.status}, '') <> 'cancelled'), 0)::numeric(14, 2)::text`,
          cancelled: sql<number>`(count(*) filter (where ${orders.status} = 'cancelled'))::int`,
        })
        .from(orders)
        .where(cond),
      this.db
        .selectDistinct({ type: orders.type })
        .from(orders)
        .where(rangeCond)
        .orderBy(asc(orders.type)),
    ]);

    return {
      from,
      to,
      page: f.page,
      per_page: ORDERS_PAGE_SIZE,
      total: totals?.orders ?? 0,
      totals: { gross_sales: totals?.gross ?? '0.00', cancelled_count: totals?.cancelled ?? 0 },
      types: types.map((t) => t.type).filter((t): t is string => !!t),
      data: rows.map((r) => ({
        id: r.id,
        pos_order_id: r.posOrderId,
        order_number: r.orderNumber,
        type: r.type,
        online_platform: r.onlinePlatform,
        status: r.status,
        table: r.tableName,
        items_count: r.itemsCount,
        total: r.total,
        paid: r.paid,
        payment_status: r.paymentStatus,
        created_at: iso(r.createdAt),
        business_date: r.businessDate,
      })),
    };
  }

  async order(store: StoreRow, orderId: string) {
    const order = await this.db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.storeId, store.id)),
    });
    if (!order) throw new NotFoundException({ error: 'order_not_found' });
    const [items, bills] = await Promise.all([
      this.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .orderBy(asc(orderItems.posItemId)),
      this.db
        .select()
        .from(orderBills)
        .where(eq(orderBills.orderId, order.id))
        .orderBy(asc(orderBills.posBillId)),
    ]);
    return {
      order: {
        id: order.id,
        pos_order_id: order.posOrderId,
        order_number: order.orderNumber,
        type: order.type,
        online_platform: order.onlinePlatform,
        external_order_id: order.externalOrderId,
        status: order.status,
        table: order.tableName,
        guests: order.guestCount,
        business_date: order.businessDate,
        created_at: iso(order.posCreatedAt),
        completed_at: iso(order.completedAt),
        cancelled_at: iso(order.cancelledAt),
        synced_at: iso(order.syncedAt),
        subtotal: order.subtotal,
        tax: order.taxAmount,
        discount: order.discountAmount,
        packaging_charge: order.packagingCharge,
        delivery_charge: order.deliveryCharge,
        service_charge: order.serviceCharge,
        round_off: order.roundOff,
        total: order.total,
        paid: order.paidAmount,
        payment_status: order.paymentStatus,
      },
      items: items.map((i) => ({
        name: i.productName,
        sku: i.productSku,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        subtotal: i.subtotal,
        tax: i.taxAmount,
        discount: i.discountAmount,
        total: i.total,
        status: i.status,
        voided: i.voidedAt !== null,
      })),
      bills: bills.map((b) => ({
        bill_number: b.billNumber,
        split_label: b.splitLabel,
        subtotal: b.subtotal,
        tax: b.taxAmount,
        discount: b.discountAmount,
        total: b.total,
        paid: b.paidAmount,
        balance: b.balance,
        payment_status: b.paymentStatus,
        paid_at: iso(b.paidAt),
      })),
    };
  }

  private storeHeader(store: StoreRow, lastSeen: Date | string | null) {
    return {
      id: store.id,
      name: store.name,
      currency: store.currency ?? 'INR',
      timezone: store.timezone,
      business_day_start: store.businessDayStart.slice(0, 5),
      online: isOnline(lastSeen),
      last_seen_at: iso(lastSeen),
    };
  }

  /** Daily totals for these business dates; with `detail`, also sales by type and by hour. */
  private async statsFor(storeId: string, days: string[], detail = false) {
    const rows = await this.db
      .select()
      .from(dailyStoreStats)
      .where(
        and(eq(dailyStoreStats.storeId, storeId), inArray(dailyStoreStats.businessDate, days)),
      );
    const totals = new Map<string, DayTotals>();
    const types = new Map<string, Record<string, { sales: string; count: number }>>();
    const hours = new Map<string, string[]>();
    for (const r of rows) {
      totals.set(r.businessDate, {
        gross_sales: r.grossSales,
        net_sales: r.netSales,
        orders_count: r.ordersCount,
        bills_count: r.billsCount,
        cancelled_count: r.cancelledCount,
        avg_bill: r.avgBill,
      });
      if (detail) {
        types.set(r.businessDate, r.byType);
        hours.set(r.businessDate, r.byHour);
      }
    }
    return { totals, types, hours };
  }

  /**
   * An earlier business day's totals up to the time of day `today` has reached, counted the way
   * daily_store_stats counts them: paid bills by when they were paid, orders by when created.
   */
  private async sameTimeTotals(
    store: StoreRow,
    day: string,
    today: string,
    now: Date,
  ): Promise<DayTotals> {
    const { rows } = await this.db.execute<{
      gross: string;
      tax: string;
      bills: number;
      orders: number;
      cancelled: number;
    }>(sql`
      with s as (select timezone as tz, business_day_start as ds from stores where id = ${store.id}),
      t as (
        select ((${day}::date + s.ds) at time zone s.tz) as start,
          ${now.toISOString()}::timestamptz - ((${today}::date + s.ds) at time zone s.tz) as elapsed
        from s
      ),
      b as (
        select bl.total, bl.tax_amount from order_bills bl, t
        where bl.store_id = ${store.id} and bl.paid_at >= t.start and bl.paid_at < t.start + t.elapsed
      ),
      o as (
        select od.status from orders od, t
        where od.store_id = ${store.id} and od.business_date = ${day}::date
          and od.pos_created_at < t.start + t.elapsed
      )
      select
        (select coalesce(sum(total), 0)::numeric(14, 2)::text from b) as gross,
        (select coalesce(sum(tax_amount), 0)::numeric(14, 2)::text from b) as tax,
        (select count(*)::int from b) as bills,
        (select count(*)::int from o where coalesce(status, '') <> 'cancelled') as orders,
        (select count(*)::int from o where status = 'cancelled') as cancelled
    `);
    const r = rows[0];
    if (!r) return emptyTotals();
    const gross = Number(r.gross);
    return {
      gross_sales: gross.toFixed(2),
      net_sales: (gross - Number(r.tax)).toFixed(2),
      orders_count: r.orders,
      bills_count: r.bills,
      cancelled_count: r.cancelled,
      avg_bill: r.bills > 0 ? (gross / r.bills).toFixed(2) : '0.00',
    };
  }

  private async fetchLive(store: StoreRow, ownerId: string): Promise<LiveResult> {
    const licence = await this.licensing.stateFor(store.id);
    if (licence.status === 'inactive' && licence.graceEndsAt.getTime() < Date.now()) {
      return this.syncedOpenOrders(store, 'licence_inactive');
    }
    const [device] = await this.db
      .select({ lastSeen: deviceLastSeen })
      .from(posDevices)
      .where(and(eq(posDevices.storeId, store.id), isNull(posDevices.revokedAt)))
      .orderBy(sql`${deviceLastSeen} desc nulls last`)
      .limit(1);
    if (!device || !isOnline(device.lastSeen)) return this.syncedOpenOrders(store, 'offline');

    const command = await this.commands.create(store.id, 'orders.live', {}, ownerId);
    const answered = await this.commands.waitForResult(command.id, LIVE_WAIT_MS);
    if (answered.status !== 'done') return this.syncedOpenOrders(store, 'no_answer');

    const raw = (answered.result as { orders?: unknown } | null)?.orders;
    const mapped = (Array.isArray(raw) ? raw : [])
      .map(mapOrderSnapshot)
      .filter((o) => o !== null)
      .slice(0, LIVE_LIMIT);
    // The answer has served its purpose; keep only how many orders it had.
    await this.commands.replaceResult(command.id, { count: mapped.length });

    const ids = await this.cloudOrderIds(
      store.id,
      mapped.map((o) => o.posOrderId),
    );
    return {
      source: 'live',
      reason: null,
      as_of: iso(answered.completedAt),
      orders: mapped.map((o) => ({
        order_id: ids.get(o.posOrderId) ?? null,
        pos_order_id: o.posOrderId,
        order_number: o.orderNumber,
        type: o.type,
        online_platform: o.onlinePlatform,
        status: o.status,
        table: o.tableName,
        guests: o.guestCount,
        total: o.total,
        paid: o.paidAmount,
        payment_status: o.paymentStatus,
        created_at: o.posCreatedAt.toISOString(),
        items: o.items.map((i) => ({
          name: i.productName,
          quantity: i.quantity,
          total: i.total,
          status: i.status,
          voided: i.voidedAt !== null,
        })),
      })),
    };
  }

  private async syncedOpenOrders(
    store: StoreRow,
    reason: LiveResult['reason'],
  ): Promise<LiveResult> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.storeId, store.id), sql`${orders.status} in (${openStatusList})`))
      .orderBy(desc(orders.posCreatedAt))
      .limit(LIVE_LIMIT);
    const items = rows.length
      ? await this.db
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(orderItems.posItemId))
      : [];
    const [synced] = await this.db
      .select({ at: max(orders.syncedAt) })
      .from(orders)
      .where(eq(orders.storeId, store.id));
    return {
      source: 'synced',
      reason,
      as_of: iso(synced?.at),
      orders: rows.map((o) => ({
        order_id: o.id,
        pos_order_id: o.posOrderId,
        order_number: o.orderNumber,
        type: o.type,
        online_platform: o.onlinePlatform,
        status: o.status,
        table: o.tableName,
        guests: o.guestCount,
        total: o.total,
        paid: o.paidAmount,
        payment_status: o.paymentStatus,
        created_at: o.posCreatedAt.toISOString(),
        items: items
          .filter((i) => i.orderId === o.id)
          .map((i) => ({
            name: i.productName,
            quantity: i.quantity,
            total: i.total,
            status: i.status,
            voided: i.voidedAt !== null,
          })),
      })),
    };
  }

  private async cloudOrderIds(storeId: string, posOrderIds: number[]) {
    if (posOrderIds.length === 0) return new Map<number, string>();
    const rows = await this.db
      .select({ id: orders.id, posOrderId: orders.posOrderId })
      .from(orders)
      .where(and(eq(orders.storeId, storeId), inArray(orders.posOrderId, posOrderIds)));
    return new Map(rows.map((r) => [r.posOrderId, r.id]));
  }
}
