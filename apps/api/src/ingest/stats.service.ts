import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Rebuilds one row of daily_store_stats. Sales follow the POS's own report: paid bills, counted
 * on the business date they were paid (store timezone and day start). Order counts use the date
 * the order was created. Refunds are not synced yet, so totals are before refunds.
 */
@Injectable()
export class StatsService {
  async recompute(tx: Tx | Database, storeId: string, businessDate: string): Promise<void> {
    await tx.execute(sql`
      with s as (
        select timezone, business_day_start from stores where id = ${storeId}
      ),
      o as (
        select
          count(*) filter (where coalesce(status, '') <> 'cancelled')::int as orders_count,
          count(*) filter (where status = 'cancelled')::int as cancelled_count
        from orders
        where store_id = ${storeId} and business_date = ${businessDate}::date
      ),
      b as (
        select bl.total, bl.tax_amount, bl.discount_amount, coalesce(od.type, 'unknown') as type,
          extract(hour from (bl.paid_at at time zone s.timezone))::int as hr
        from order_bills bl
        join orders od on od.id = bl.order_id
        cross join s
        where bl.store_id = ${storeId}
          and bl.paid_at is not null
          and ((bl.paid_at at time zone s.timezone) - s.business_day_start)::date = ${businessDate}::date
      ),
      agg as (
        select count(*)::int as bills_count,
          coalesce(sum(total), 0) as gross,
          coalesce(sum(tax_amount), 0) as tax,
          coalesce(sum(discount_amount), 0) as discount
        from b
      ),
      by_type as (
        select coalesce(jsonb_object_agg(type, jsonb_build_object(
          'sales', sales::numeric(14, 2)::text, 'count', cnt)), '{}'::jsonb) as v
        from (select type, sum(total) as sales, count(*)::int as cnt from b group by type) t
      ),
      by_hour as (
        select jsonb_agg(coalesce(h.sales, 0)::numeric(14, 2)::text order by g) as v
        from generate_series(0, 23) g
        left join (select hr, sum(total) as sales from b group by hr) h on h.hr = g
      )
      insert into daily_store_stats (
        store_id, business_date, orders_count, cancelled_count, bills_count,
        gross_sales, net_sales, tax_total, discount_total, avg_bill, by_type, by_hour, updated_at
      )
      select ${storeId}, ${businessDate}::date, o.orders_count, o.cancelled_count, agg.bills_count,
        agg.gross, agg.gross - agg.tax, agg.tax, agg.discount,
        case when agg.bills_count > 0 then round(agg.gross / agg.bills_count, 2) else 0 end,
        by_type.v, by_hour.v, now()
      from o, agg, by_type, by_hour
      on conflict (store_id, business_date) do update set
        orders_count = excluded.orders_count,
        cancelled_count = excluded.cancelled_count,
        bills_count = excluded.bills_count,
        gross_sales = excluded.gross_sales,
        net_sales = excluded.net_sales,
        tax_total = excluded.tax_total,
        discount_total = excluded.discount_total,
        avg_bill = excluded.avg_bill,
        by_type = excluded.by_type,
        by_hour = excluded.by_hour,
        updated_at = now()
    `);
  }

  /**
   * After the store's timezone or day start changes: moves orders created since `since` to the
   * business date the new settings give, then rebuilds every daily row those orders, their bills,
   * or the old rows covered.
   */
  async rebuildSince(tx: Tx | Database, storeId: string, since: Date): Promise<void> {
    const from = since.toISOString();
    const { rows: oldDays } = await tx.execute<{ day: string }>(sql`
      select business_date::text as day from daily_store_stats
      where store_id = ${storeId} and business_date >= ${from}::timestamptz::date - 1
    `);
    await tx.execute(sql`
      update orders o
      set business_date = ((o.pos_created_at at time zone s.timezone) - s.business_day_start)::date
      from stores s
      where s.id = o.store_id and o.store_id = ${storeId} and o.pos_created_at >= ${from}
    `);
    await tx.execute(sql`
      update order_items i set business_date = o.business_date
      from orders o
      where o.id = i.order_id and o.store_id = ${storeId} and o.pos_created_at >= ${from}
    `);
    const { rows: newDays } = await tx.execute<{ day: string }>(sql`
      select business_date::text as day from orders
      where store_id = ${storeId} and pos_created_at >= ${from}
      union
      select ((bl.paid_at at time zone s.timezone) - s.business_day_start)::date::text
      from order_bills bl
      join stores s on s.id = bl.store_id
      where bl.store_id = ${storeId} and bl.paid_at >= ${from}
    `);
    const days = new Set([...oldDays, ...newDays].map((r) => r.day));
    for (const day of days) await this.recompute(tx, storeId, day);
  }
}
