import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import { POS_ONLINE_MINUTES } from '../pos/device-status.js';
import { type AdminRow, can } from './admin-auth.service.js';

/** Longest range the dashboard accepts, so one request can't scan years of data. */
export const DASHBOARD_MAX_DAYS = 366;
const DAY_MS = 86_400_000;
const IST = 'Asia/Kolkata';

/** Start of an IST calendar day, as an instant. */
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

type Pair = { current: number; previous: number };
const pair = (row: { cur: unknown; prev: unknown } | undefined): Pair => ({
  current: Number(row?.cur ?? 0),
  previous: Number(row?.prev ?? 0),
});

/**
 * The overview page: totals for an IST date range against the same number of days just before it,
 * a daily series for the chart, live counts and the latest payments and stores. Money and leads
 * are left out (null) for admins whose role can't see them.
 */
@Injectable()
export class AdminDashboardService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async dashboard(from: string, to: string, me: AdminRow) {
    if (from > to) throw new BadRequestException({ error: 'invalid_range' });
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    if (days > DASHBOARD_MAX_DAYS) throw new BadRequestException({ error: 'range_too_long' });
    const prevFrom = shiftDay(from, -days);
    const prevTo = shiftDay(from, -1);
    const start = istStart(from);
    const end = istStart(shiftDay(to, 1));
    const prevStart = istStart(prevFrom);
    const seesMoney = can(me, 'stores.licence');
    const seesLeads = can(me, 'leads.view');

    const between = (col: ReturnType<typeof sql>, a: Date, b: Date) =>
      sql`${col} >= ${a.toISOString()}::timestamptz and ${col} < ${b.toISOString()}::timestamptz`;
    const curPrev = (col: ReturnType<typeof sql>) => ({
      cur: between(col, start, end),
      prev: between(col, prevStart, start),
    });

    const paidAt = curPrev(sql`p.paid_at`);
    const storeAt = curPrev(sql`s.created_at`);
    const leadAt = curPrev(sql`l.created_at`);
    const wonAt = between(sql`l.won_at`, start, end);
    const lostAt = between(sql`l.lost_at`, start, end);
    const onlineSince = new Date(Date.now() - POS_ONLINE_MINUTES * 60_000).toISOString();
    const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
    const weekAhead = new Date(Date.now() + 7 * DAY_MS).toISOString();

    const [revenue, newStores, sales, leadsRow, series, live, payments, newest] = await Promise.all(
      [
        seesMoney
          ? this.db.execute<{ cur: string; prev: string; n: number; prev_n: number }>(sql`
              select coalesce(sum(p.amount) filter (where ${paidAt.cur}), 0) as cur,
                     coalesce(sum(p.amount) filter (where ${paidAt.prev}), 0) as prev,
                     (count(*) filter (where ${paidAt.cur}))::int as n,
                     (count(*) filter (where ${paidAt.prev}))::int as prev_n
              from subscription_payments p
              where p.status = 'paid' and ${between(sql`p.paid_at`, prevStart, end)}`)
          : null,
        this.db.execute<{ cur: number; prev: number; trials: number }>(sql`
          select (count(*) filter (where ${storeAt.cur}))::int as cur,
                 (count(*) filter (where ${storeAt.prev}))::int as prev,
                 (select count(*)::int from subscriptions where status = 'trial') as trials
          from stores s
          where s.status <> 'deleted' and ${between(sql`s.created_at`, prevStart, end)}`),
        this.db.execute<{ cur: string; prev: string; bills: number; stores: number }>(sql`
          select coalesce(sum(d.gross_sales) filter (where d.business_date >= ${from}::date), 0) as cur,
                 coalesce(sum(d.gross_sales) filter (where d.business_date < ${from}::date), 0) as prev,
                 coalesce(sum(d.bills_count) filter (where d.business_date >= ${from}::date), 0)::int as bills,
                 (count(distinct d.store_id) filter (where d.business_date >= ${from}::date))::int as stores
          from daily_store_stats d
          where d.business_date between ${prevFrom}::date and ${to}::date`),
        seesLeads
          ? this.db.execute<{ cur: number; prev: number; won: number; lost: number }>(sql`
              select (count(*) filter (where ${leadAt.cur}))::int as cur,
                     (count(*) filter (where ${leadAt.prev}))::int as prev,
                     (count(*) filter (where ${wonAt}))::int as won,
                     (count(*) filter (where ${lostAt}))::int as lost
              from leads l
              where l.deleted_at is null`)
          : null,
        this.db.execute<{
          day: string;
          revenue: string;
          sales: string;
          stores: number;
          leads: number;
        }>(sql`
          with days as (
            select d::date as day from generate_series(${from}::date, ${to}::date, interval '1 day') d
          )
          select to_char(days.day, 'YYYY-MM-DD') as day,
                 coalesce(r.revenue, 0) as revenue,
                 coalesce(g.sales, 0) as sales,
                 coalesce(st.n, 0)::int as stores,
                 coalesce(ld.n, 0)::int as leads
          from days
          left join (
            select (paid_at at time zone ${IST})::date as day, sum(amount) as revenue
            from subscription_payments
            where status = 'paid' and ${seesMoney ? sql`true` : sql`false`}
              and ${between(sql`paid_at`, start, end)}
            group by 1
          ) r on r.day = days.day
          left join (
            select business_date as day, sum(gross_sales) as sales
            from daily_store_stats
            where business_date between ${from}::date and ${to}::date
            group by 1
          ) g on g.day = days.day
          left join (
            select (created_at at time zone ${IST})::date as day, count(*) as n
            from stores
            where status <> 'deleted' and ${between(sql`created_at`, start, end)}
            group by 1
          ) st on st.day = days.day
          left join (
            select (created_at at time zone ${IST})::date as day, count(*) as n
            from leads
            where deleted_at is null and ${seesLeads ? sql`true` : sql`false`}
              and ${between(sql`created_at`, start, end)}
            group by 1
          ) ld on ld.day = days.day
          order by days.day`),
        this.db.execute<{
          stores: number;
          online: number;
          offline: number;
          trials_ending: number;
          past_due: number;
          suspended: number;
          open_tickets: number;
          overdue: number;
        }>(sql`
          with seen as (
            select s.id, s.status,
                   max(greatest(d.last_heartbeat_at, d.last_licence_at)) as last_seen
            from stores s
            left join pos_devices d on d.store_id = s.id
            where s.status <> 'deleted'
            group by s.id, s.status
          )
          select count(*)::int as stores,
                 (count(*) filter (where last_seen >= ${onlineSince}::timestamptz))::int as online,
                 (count(*) filter (where status = 'active'
                   and (last_seen is null or last_seen < ${dayAgo}::timestamptz)))::int as offline,
                 (select count(*)::int from subscriptions
                   where status = 'trial' and trial_ends_at >= now()
                     and trial_ends_at < ${weekAhead}::timestamptz) as trials_ending,
                 (select count(*)::int from subscriptions where status = 'past_due') as past_due,
                 (count(*) filter (where status = 'suspended'))::int as suspended,
                 (select count(*)::int from support_tickets
                   where status in ('open', 'in_progress')) as open_tickets,
                 (select count(*)::int from leads
                   where deleted_at is null and next_follow_up_at < now()
                     and stage not in ('won', 'lost')) as overdue
          from seen`),
        seesMoney
          ? this.db.execute<{
              id: string;
              store_id: string;
              store_name: string;
              plan_name: string | null;
              method: string;
              amount: string;
              currency: string;
              paid_at: string;
            }>(sql`
              select p.id, s.id as store_id, s.name as store_name, pl.name as plan_name,
                     p.method, p.amount, p.currency, p.paid_at
              from subscription_payments p
              join subscriptions sub on sub.id = p.subscription_id
              join stores s on s.id = sub.store_id
              left join plans pl on pl.id = sub.plan_id
              where p.status = 'paid'
              order by p.paid_at desc
              limit 6`)
          : null,
        this.db.execute<{
          id: string;
          name: string;
          phone: string | null;
          created_at: string;
          licence: string | null;
        }>(sql`
          select s.id, s.name, s.phone, s.created_at,
                 (select status from subscriptions where store_id = s.id
                   order by created_at desc limit 1) as licence
          from stores s
          where s.status <> 'deleted'
          order by s.created_at desc
          limit 6`),
      ],
    );

    const lead = leadsRow?.rows[0];
    const rev = revenue?.rows[0];
    const ops = live.rows[0];
    return {
      range: { from, to, days, previous_from: prevFrom, previous_to: prevTo },
      revenue: rev ? { ...pair(rev), payments: rev.n, previous_payments: rev.prev_n } : null,
      new_stores: { ...pair(newStores.rows[0]), on_trial: newStores.rows[0]?.trials ?? 0 },
      cafe_sales: {
        ...pair(sales.rows[0]),
        bills: sales.rows[0]?.bills ?? 0,
        stores: sales.rows[0]?.stores ?? 0,
      },
      new_leads: lead ? { ...pair(lead), won: lead.won, lost: lead.lost } : null,
      series: series.rows.map((r) => ({
        day: r.day,
        revenue: seesMoney ? Number(r.revenue) : null,
        cafe_sales: Number(r.sales),
        new_stores: r.stores,
        new_leads: seesLeads ? r.leads : null,
      })),
      live: {
        stores: ops?.stores ?? 0,
        online: ops?.online ?? 0,
        offline_day: ops?.offline ?? 0,
        trials_ending: ops?.trials_ending ?? 0,
        past_due: ops?.past_due ?? 0,
        suspended: ops?.suspended ?? 0,
        open_tickets: ops?.open_tickets ?? 0,
        overdue_follow_ups: seesLeads ? (ops?.overdue ?? 0) : null,
      },
      recent_payments: payments?.rows ?? null,
      newest_stores: newest.rows,
    };
  }
}
