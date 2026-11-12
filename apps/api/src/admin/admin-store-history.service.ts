import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import { stores } from '../db/schema/index.js';
import { OwnerReportsService } from '../owner-reports/owner-reports.service.js';
import { addDays } from '../owner-stores/owner-stores.service.js';
import { businessDate } from '../sales/business-date.js';

export const HISTORY_RANGES = [7, 30, 90] as const;
export type HistoryDays = (typeof HISTORY_RANGES)[number];

const TOP_ITEMS = 10;

type OnlineRow = {
  day: string;
  recorded: boolean;
  online_seconds: number;
  day_seconds: number;
  sessions: number;
};
type FlowRow = {
  day: string;
  orders: number;
  completed: number;
  cancelled: number;
  avg_complete_seconds: number | null;
};

/** A store's trends over its last 7, 30 or 90 business days, for the admin history page. */
@Injectable()
export class AdminStoreHistoryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reports: OwnerReportsService,
  ) {}

  async history(storeId: string, days: HistoryDays, now = new Date()) {
    const store = await this.db.query.stores.findFirst({ where: eq(stores.id, storeId) });
    if (!store) throw new NotFoundException({ error: 'store_not_found' });
    const to = businessDate(now, store.timezone, store.businessDayStart);
    const from = addDays(to, -(days - 1));

    const [sales, hours, items, online, flow] = await Promise.all([
      this.reports.sales(store, { from, to, group: 'day' }),
      this.reports.hours(store, { from, to }),
      this.reports.items(store, { from, to }),
      this.online(store, from, to, now),
      this.orderFlow(store.id, from, to),
    ]);

    return {
      store: { id: store.id, name: store.name, status: store.status },
      from,
      to,
      days,
      timezone: store.timezone,
      currency: store.currency ?? 'INR',
      online,
      orders: flow,
      sales: { totals: sales.totals, previous: sales.previous, by_type: sales.by_type },
      sales_by_day: sales.periods.map((p) => ({
        day: p.start,
        gross_sales: p.gross_sales,
        bills_count: p.bills_count,
        avg_bill: p.avg_bill,
      })),
      hours: {
        busiest_hour: hours.busiest_hour,
        days_with_sales: hours.days_with_sales,
        hours: hours.hours,
      },
      top_items: { totals: items.totals, items: items.items.slice(0, TOP_ITEMS) },
    };
  }

  /**
   * Time any POS of the store was online on each business day: the devices' online periods merged,
   * so two tills online together count once. Days before recording began are marked unrecorded.
   */
  private async online(store: typeof stores.$inferSelect, from: string, to: string, now: Date) {
    const at = now.toISOString();
    const firstSeen = sql`(select min(started_at) from pos_presence where store_id = ${store.id})`;
    const [rows, first] = await Promise.all([
      this.db.execute<OnlineRow>(sql`
        with days as (
          select d::date as day,
            tstzrange(
              (d::date + ${store.businessDayStart}::time) at time zone ${store.timezone},
              (d::date + 1 + ${store.businessDayStart}::time) at time zone ${store.timezone}
            ) * tstzrange(null, ${at}::timestamptz) as span
          from generate_series(${from}::date, ${to}::date, interval '1 day') d
        ),
        merged as (
          select unnest(range_agg(tstzrange(started_at, last_seen_at, '[]'))) as r
          from pos_presence
          where store_id = ${store.id}
            and last_seen_at >= (select min(lower(span)) from days)
        )
        select to_char(days.day, 'YYYY-MM-DD') as day,
          coalesce(upper(days.span) > ${firstSeen}, false) as recorded,
          coalesce(sum(extract(epoch from upper(merged.r * days.span) - lower(merged.r * days.span))), 0)::float8 as online_seconds,
          coalesce(extract(epoch from
            upper(days.span * tstzrange(${firstSeen}, null))
            - lower(days.span * tstzrange(${firstSeen}, null))), 0)::float8 as day_seconds,
          (select count(*)::int from pos_presence p
            where p.store_id = ${store.id} and p.started_at <@ days.span) as sessions
        from days
        left join merged on merged.r && days.span
        group by days.day, days.span
        order by days.day`),
      this.db.execute<{ at: string | null }>(sql`
        select min(started_at)::text as at from pos_presence where store_id = ${store.id}`),
    ]);
    const since = first.rows[0]?.at ? new Date(first.rows[0].at) : null;
    let onlineSeconds = 0;
    let recordedSeconds = 0;
    const byDay = rows.rows.map((r) => {
      if (r.recorded) {
        onlineSeconds += r.online_seconds;
        recordedSeconds += r.day_seconds;
      }
      return {
        day: r.day,
        recorded: r.recorded,
        online_seconds: Math.round(r.online_seconds),
        uptime_pct: r.recorded && r.day_seconds > 0 ? pct(r.online_seconds, r.day_seconds) : null,
        sessions: r.sessions,
      };
    });
    return {
      recorded_since: since,
      online_seconds: Math.round(onlineSeconds),
      uptime_pct: recordedSeconds > 0 ? pct(onlineSeconds, recordedSeconds) : null,
      by_day: byDay,
    };
  }

  /** Orders by business day: how many came in, finished or were cancelled, and how fast. */
  private async orderFlow(storeId: string, from: string, to: string) {
    const scope = sql`from orders where store_id = ${storeId}
      and business_date between ${from}::date and ${to}::date`;
    const completeSeconds = sql`extract(epoch from completed_at - pos_created_at)`;
    const finished = sql`completed_at is not null and completed_at >= pos_created_at`;
    const cancelled = sql`(status = 'cancelled' or cancelled_at is not null)`;
    const [byDay, totals, statuses] = await Promise.all([
      this.db.execute<FlowRow>(sql`
        select to_char(business_date, 'YYYY-MM-DD') as day,
          count(*)::int as orders,
          count(*) filter (where ${finished})::int as completed,
          count(*) filter (where ${cancelled})::int as cancelled,
          avg(${completeSeconds}) filter (where ${finished})::float8 as avg_complete_seconds
        ${scope}
        group by business_date`),
      this.db.execute<{
        orders: number;
        completed: number;
        cancelled: number;
        median_complete_seconds: number | null;
        avg_sync_seconds: number | null;
      }>(sql`
        select count(*)::int as orders,
          count(*) filter (where ${finished})::int as completed,
          count(*) filter (where ${cancelled})::int as cancelled,
          (percentile_cont(0.5) within group (order by ${completeSeconds})
            filter (where ${finished}))::float8 as median_complete_seconds,
          avg(greatest(extract(epoch from synced_at - pos_updated_at), 0))::float8 as avg_sync_seconds
        ${scope}`),
      this.db.execute<{ status: string; count: number }>(sql`
        select coalesce(nullif(status, ''), 'unknown') as status, count(*)::int as count
        ${scope}
        group by 1
        order by 2 desc`),
    ]);
    const rows = new Map(byDay.rows.map((r) => [r.day, r]));
    const days: FlowRow[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const r = rows.get(day);
      days.push({
        day,
        orders: r?.orders ?? 0,
        completed: r?.completed ?? 0,
        cancelled: r?.cancelled ?? 0,
        avg_complete_seconds:
          r?.avg_complete_seconds == null ? null : Math.round(r.avg_complete_seconds),
      });
    }
    const t = totals.rows[0];
    return {
      totals: {
        orders: t?.orders ?? 0,
        completed: t?.completed ?? 0,
        cancelled: t?.cancelled ?? 0,
        median_complete_seconds:
          t?.median_complete_seconds == null ? null : Math.round(t.median_complete_seconds),
        avg_sync_seconds: t?.avg_sync_seconds == null ? null : Math.round(t.avg_sync_seconds),
      },
      by_status: statuses.rows,
      by_day: days,
    };
  }
}

const pct = (part: number, whole: number) => Math.round(Math.min(1, part / whole) * 1000) / 10;
