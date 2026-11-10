import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { CommandsService } from '../commands/commands.service.js';
import { DB, type Database } from '../db/database.module.js';
import { dailyStoreStats, posDevices } from '../db/schema/index.js';
import { addDays, MAX_RANGE_DAYS } from '../owner-stores/owner-stores.service.js';
import type { StoreRow } from '../owner-stores/store-member.guard.js';
import { deviceLastSeen, isOnline } from '../pos/device-status.js';
import { LicensingService } from '../pos/licensing.service.js';
import { businessDate } from '../sales/business-date.js';

/** Reports by week or month may cover two years; by day, items and payments cover MAX_RANGE_DAYS. */
export const MAX_LONG_RANGE_DAYS = 731;
export const ITEMS_LIMIT = 100;
const PAYMENTS_WAIT_MS = 8_000;
const PAYMENTS_CACHE_MS = 5 * 60_000;
const PAYMENTS_RETRY_MS = 10_000;
const PAYMENTS_CACHE_SIZE = 500;

export type ReportGroup = 'day' | 'week' | 'month';
export type RangeQuery = { from?: string; to?: string };

export type ReportTotals = {
  gross_sales: string;
  net_sales: string;
  tax_total: string;
  discount_total: string;
  avg_bill: string;
  orders_count: number;
  bills_count: number;
  cancelled_count: number;
};
export type SalesPeriod = ReportTotals & { start: string; end: string; partial: boolean };
export type SalesReport = {
  from: string;
  to: string;
  group: ReportGroup;
  totals: ReportTotals;
  previous: ReportTotals & { from: string; to: string };
  by_type: Record<string, { sales: string; count: number }>;
  periods: SalesPeriod[];
};

export type ItemsReport = {
  from: string;
  to: string;
  sort: 'revenue' | 'quantity';
  limit: number;
  totals: { revenue: string; quantity: string; products: number };
  items: { name: string; quantity: string; revenue: string; share: number }[];
};

export type HoursReport = {
  from: string;
  to: string;
  total_sales: string;
  days_with_sales: number;
  busiest_hour: number | null;
  hours: { hour: number; sales: string; average: string }[];
};

export type PaymentsReport = {
  from: string;
  to: string;
  available: boolean;
  /** Why there are no totals: the POS is offline, didn't answer in time, or the licence ended. */
  reason: 'offline' | 'no_answer' | 'licence_inactive' | null;
  as_of: string | null;
  total: string;
  methods: { method: string; amount: string; count: number; percent: number }[];
};

type StatsRow = typeof dailyStoreStats.$inferSelect;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// Money is summed in hundredths so long ranges don't pick up floating-point error.
const cents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const money = (c: number) => (c / 100).toFixed(2);

/** The Monday-to-Sunday week or calendar month a business date falls in. */
function periodOf(day: string, group: ReportGroup): { start: string; end: string } {
  if (group === 'day') return { start: day, end: day };
  if (group === 'week') {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const start = addDays(day, -((weekday + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  const [year, month] = day.split('-').map(Number);
  return {
    start: `${day.slice(0, 7)}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

class Sums {
  gross = 0;
  net = 0;
  tax = 0;
  discount = 0;
  orders = 0;
  bills = 0;
  cancelled = 0;

  add(row: StatsRow | undefined): this {
    if (!row) return this;
    this.gross += cents(row.grossSales);
    this.net += cents(row.netSales);
    this.tax += cents(row.taxTotal);
    this.discount += cents(row.discountTotal);
    this.orders += row.ordersCount;
    this.bills += row.billsCount;
    this.cancelled += row.cancelledCount;
    return this;
  }

  totals(): ReportTotals {
    return {
      gross_sales: money(this.gross),
      net_sales: money(this.net),
      tax_total: money(this.tax),
      discount_total: money(this.discount),
      // Gross over bills, not an average of the daily averages.
      avg_bill: this.bills > 0 ? money(Math.round(this.gross / this.bills)) : '0.00',
      orders_count: this.orders,
      bills_count: this.bills,
      cancelled_count: this.cancelled,
    };
  }
}

/** Reports for the owner portal: sales, items and hours from synced data, payments from the POS. */
@Injectable()
export class OwnerReportsService {
  /** One payments answer per store and range, shared by every viewer for a few minutes. */
  private readonly paymentsCache = new Map<
    string,
    { until: number; result: Promise<PaymentsReport> }
  >();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly commands: CommandsService,
    private readonly licensing: LicensingService,
  ) {}

  async sales(store: StoreRow, q: RangeQuery & { group?: ReportGroup }): Promise<SalesReport> {
    const group = q.group ?? 'day';
    const { from, to } = this.range(
      store,
      q,
      group === 'day' ? MAX_RANGE_DAYS : MAX_LONG_RANGE_DAYS,
    );
    const days = daysBetween(from, to) + 1;
    const previousFrom = addDays(from, -days);
    const previousTo = addDays(from, -1);
    const byDay = await this.statsRows(store.id, previousFrom, to);

    const total = new Sums();
    const previous = new Sums();
    const types = new Map<string, { sales: number; count: number }>();
    const periods = new Map<string, { end: string; sums: Sums }>();
    for (let day = previousFrom; day <= to; day = addDays(day, 1)) {
      const row = byDay.get(day);
      if (day < from) {
        previous.add(row);
        continue;
      }
      total.add(row);
      const period = periodOf(day, group);
      if (!periods.has(period.start))
        periods.set(period.start, { end: period.end, sums: new Sums() });
      periods.get(period.start)!.sums.add(row);
      for (const [type, t] of Object.entries(row?.byType ?? {})) {
        const sum = types.get(type) ?? { sales: 0, count: 0 };
        sum.sales += cents(t.sales);
        sum.count += t.count;
        types.set(type, sum);
      }
    }

    return {
      from,
      to,
      group,
      totals: total.totals(),
      previous: { from: previousFrom, to: previousTo, ...previous.totals() },
      by_type: Object.fromEntries(
        [...types].map(([type, t]) => [type, { sales: money(t.sales), count: t.count }]),
      ),
      periods: [...periods].map(([start, p]) => ({
        start: start < from ? from : start,
        end: p.end > to ? to : p.end,
        partial: start < from || p.end > to,
        ...p.sums.totals(),
      })),
    };
  }

  /** Items on the order's business date; voided items and cancelled orders are left out. */
  async items(
    store: StoreRow,
    q: RangeQuery & { sort?: 'revenue' | 'quantity'; q?: string },
  ): Promise<ItemsReport> {
    const sort = q.sort ?? 'revenue';
    const { from, to } = this.range(store, q, MAX_RANGE_DAYS);
    const sold = sql`
      from order_items i
      join orders o on o.id = i.order_id
      where i.store_id = ${store.id}
        and i.business_date between ${from}::date and ${to}::date
        and i.voided_at is null
        and coalesce(o.status, '') <> 'cancelled'`;
    const search = q.q
      ? sql`and i.product_name ilike ${`%${q.q.replace(/[%_\\]/g, '\\$&')}%`}`
      : sql``;
    const order = sort === 'quantity' ? sql`sum(i.quantity) desc` : sql`sum(i.total) desc`;

    const [totals, list] = await Promise.all([
      this.db.execute<{ revenue: string; quantity: string; products: number }>(sql`
        select coalesce(sum(i.total), 0)::numeric(14, 2)::text as revenue,
          coalesce(sum(i.quantity), 0)::numeric(14, 3)::text as quantity,
          count(distinct i.product_name)::int as products
        ${sold}`),
      this.db.execute<{ name: string; quantity: string; revenue: string }>(sql`
        select i.product_name as name,
          sum(i.quantity)::numeric(14, 3)::text as quantity,
          sum(i.total)::numeric(14, 2)::text as revenue
        ${sold} ${search}
        group by i.product_name
        order by ${order}, i.product_name
        limit ${ITEMS_LIMIT}`),
    ]);
    const all = totals.rows[0] ?? { revenue: '0.00', quantity: '0.000', products: 0 };
    const revenue = cents(all.revenue);

    return {
      from,
      to,
      sort,
      limit: ITEMS_LIMIT,
      totals: all,
      items: list.rows.map((r) => ({
        ...r,
        share: revenue > 0 ? Math.round((cents(r.revenue) / revenue) * 1000) / 10 : 0,
      })),
    };
  }

  async hours(store: StoreRow, q: RangeQuery): Promise<HoursReport> {
    const { from, to } = this.range(store, q, MAX_RANGE_DAYS);
    const byDay = await this.statsRows(store.id, from, to);
    const sums = Array.from({ length: 24 }, () => 0);
    let daysWithSales = 0;
    for (const row of byDay.values()) {
      if (cents(row.grossSales) > 0) daysWithSales += 1;
      row.byHour.forEach((sales, hour) => {
        if (hour < 24) sums[hour] += cents(sales);
      });
    }
    const top = Math.max(...sums);
    // by_hour is indexed by clock hour; the chart starts at the business day start.
    const startHour = Number(store.businessDayStart.slice(0, 2)) || 0;

    return {
      from,
      to,
      total_sales: money(sums.reduce((a, b) => a + b, 0)),
      days_with_sales: daysWithSales,
      busiest_hour: top > 0 ? sums.indexOf(top) : null,
      hours: Array.from({ length: 24 }, (_, i) => {
        const hour = (startHour + i) % 24;
        return {
          hour,
          sales: money(sums[hour]),
          average: daysWithSales > 0 ? money(Math.round(sums[hour] / daysWithSales)) : '0.00',
        };
      }),
    };
  }

  /** The cash/UPI/card split, which only the POS has: synced bills carry no payment methods. */
  async payments(store: StoreRow, ownerId: string, q: RangeQuery): Promise<PaymentsReport> {
    const { from, to } = this.range(store, q, MAX_RANGE_DAYS);
    const key = `${store.id}:${from}:${to}`;
    const now = Date.now();
    const cached = this.paymentsCache.get(key);
    if (cached && cached.until > now) return cached.result;
    if (this.paymentsCache.size >= PAYMENTS_CACHE_SIZE) {
      for (const [k, entry] of this.paymentsCache) {
        if (entry.until <= now) this.paymentsCache.delete(k);
      }
    }

    const entry = {
      until: now + PAYMENTS_CACHE_MS,
      result: this.fetchPayments(store, ownerId, from, to),
    };
    this.paymentsCache.set(key, entry);
    entry.result.then(
      (report) => {
        // No totals yet: let the owner try again soon instead of holding the miss for minutes.
        if (!report.available) entry.until = Date.now() + PAYMENTS_RETRY_MS;
      },
      () => this.paymentsCache.delete(key),
    );
    return entry.result;
  }

  private async fetchPayments(
    store: StoreRow,
    ownerId: string,
    from: string,
    to: string,
  ): Promise<PaymentsReport> {
    const unavailable = (reason: PaymentsReport['reason']): PaymentsReport => ({
      from,
      to,
      available: false,
      reason,
      as_of: null,
      total: '0.00',
      methods: [],
    });
    const licence = await this.licensing.stateFor(store.id);
    if (licence.status === 'inactive' && licence.graceEndsAt.getTime() < Date.now()) {
      return unavailable('licence_inactive');
    }
    const [device] = await this.db
      .select({ lastSeen: deviceLastSeen })
      .from(posDevices)
      .where(and(eq(posDevices.storeId, store.id), isNull(posDevices.revokedAt)))
      .orderBy(sql`${deviceLastSeen} desc nulls last`)
      .limit(1);
    if (!device || !isOnline(device.lastSeen)) return unavailable('offline');

    const command = await this.commands.create(store.id, 'report.payments', { from, to }, ownerId);
    const answered = await this.commands.waitForResult(command.id, PAYMENTS_WAIT_MS);
    if (answered.status !== 'done') return unavailable('no_answer');

    const raw = (answered.result as { breakdown?: unknown } | null)?.breakdown;
    const rows = (Array.isArray(raw) ? raw : [])
      .map((r: { method?: unknown; amount?: unknown; count?: unknown }) => ({
        method: String(r?.method ?? '').slice(0, 64) || 'Other',
        amount: cents(Number(r?.amount) || 0),
        count: Math.max(0, Math.trunc(Number(r?.count) || 0)),
      }))
      .sort((a, b) => b.amount - a.amount);
    // The answer has served its purpose; keep only how many methods it had.
    await this.commands.replaceResult(command.id, { methods: rows.length });

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return {
      from,
      to,
      available: true,
      reason: null,
      as_of: answered.completedAt ? new Date(answered.completedAt).toISOString() : null,
      total: money(total),
      methods: rows.map((r) => ({
        method: r.method,
        amount: money(r.amount),
        count: r.count,
        percent: total > 0 ? Math.round((r.amount / total) * 1000) / 10 : 0,
      })),
    };
  }

  /** Both dates default to the store's today; the range may not reach into the future. */
  private range(store: StoreRow, q: RangeQuery, maxDays: number): { from: string; to: string } {
    const today = businessDate(new Date(), store.timezone, store.businessDayStart);
    const from = q.from ?? q.to ?? today;
    const to = q.to ?? from;
    if (from > to) throw new BadRequestException({ error: 'invalid_range' });
    if (to > today) throw new BadRequestException({ error: 'future_date' });
    if (daysBetween(from, to) >= maxDays) {
      throw new BadRequestException({ error: 'range_too_long', max_days: maxDays });
    }
    return { from, to };
  }

  private async statsRows(storeId: string, from: string, to: string) {
    const rows = await this.db
      .select()
      .from(dailyStoreStats)
      .where(
        and(
          eq(dailyStoreStats.storeId, storeId),
          gte(dailyStoreStats.businessDate, from),
          lte(dailyStoreStats.businessDate, to),
        ),
      );
    return new Map(rows.map((r) => [r.businessDate, r]));
  }
}
