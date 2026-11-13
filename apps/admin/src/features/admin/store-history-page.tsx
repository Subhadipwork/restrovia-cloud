'use client';

import Link from 'next/link';
import { parseAsInteger, useQueryState } from 'nuqs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EChartsHeatmapChart } from '@/components/evilcharts/charts/echarts-heatmap-chart';
import { ValueBarChart } from '@/components/value-bar-chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatDateTime, formatDuration, formatMoney } from '@/lib/display';
import { type StoreHistory, useStoreHistory } from './api';
import { QueryState } from './ui';

const RANGES = [7, 30, 90] as const;

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
  online: 'Online',
  unknown: 'Other'
};

const label = (value: string) =>
  TYPE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

/** "4 Nov" in the store's calendar; business dates are plain dates, not instants. */
const shortDay = (day: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`)
  );

const hourLabel = (hour: number) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, hour))
  );

type BarRow = { label: string; value: number | null; detail: string };

/** One measure per chart, one hue, values in the tooltip and in the daily table below. */
function BarsCard({
  title,
  description,
  rows,
  empty
}: {
  title: string;
  description: string;
  rows: BarRow[];
  empty: string;
}) {
  const hasData = rows.some((r) => (r.value ?? 0) > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className='text-muted-foreground text-sm'>{empty}</p>
        ) : (
          <ValueBarChart rows={rows} seriesLabel={title} />
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className='gap-1 py-4'>
      <CardContent className='px-4'>
        <div className='text-muted-foreground text-xs'>{label}</div>
        <div className='text-2xl font-semibold tabular-nums'>{value}</div>
        {note && <div className='text-muted-foreground mt-0.5 text-xs'>{note}</div>}
      </CardContent>
    </Card>
  );
}

/** A labelled share bar: for breakdowns, where the number matters more than the shape. */
function ShareList({
  rows,
  empty
}: {
  rows: { key: string; label: string; value: string; share: number }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className='text-muted-foreground text-sm'>{empty}</p>;
  return (
    <ul className='flex flex-col gap-2.5 text-sm'>
      {rows.map((r) => (
        <li key={r.key} className='flex flex-col gap-1'>
          <span className='flex justify-between gap-2'>
            <span>{r.label}</span>
            <span className='text-muted-foreground tabular-nums'>
              {r.value} · {r.share}%
            </span>
          </span>
          <span className='bg-muted h-1.5 overflow-hidden rounded-full'>
            <span
              className='block h-full rounded-full'
              style={{ width: `${r.share}%`, background: 'var(--chart-2)' }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

const share = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function change(now: number, before: number, days: number): string | undefined {
  if (!before) return undefined;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}${Math.abs(pct)}% vs previous ${days} days`;
}

/** Darker as more of the day was online; a ramp of the theme's chart colour, light to full. */
const ONLINE_COLORS = [15, 35, 55, 75, 100].map((pct) =>
  pct === 100 ? 'var(--chart-2)' : `color-mix(in oklab, var(--chart-2) ${pct}%, transparent)`
);
/** Hours online that start each colour level after the first (under 1 h is the lightest). */
const ONLINE_THRESHOLDS = [1, 6, 12, 20];

const weekdayDay = (day: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${day}T00:00:00Z`));

/** One cell per day, like a contribution calendar; days with no record stay empty. */
function OnlineHeatmapCard({ data }: { data: StoreHistory }) {
  const { online } = data;
  const recorded = online.by_day.filter((d) => d.recorded);
  const cells = recorded.map((d) => ({
    date: d.day,
    value: Math.round((d.online_seconds / 3600) * 10) / 10
  }));
  const config = {
    online: { label: 'Online', colors: { light: ONLINE_COLORS, dark: ONLINE_COLORS } }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Online time</CardTitle>
        <CardDescription>
          Hours any POS was online each day; darker is longer. Empty days have no record
          {online.recorded_since
            ? ` (recorded since ${formatDateTime(online.recorded_since)})`
            : ''}
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cells.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            No online time recorded in this range yet.
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <EChartsHeatmapChart
              data={cells}
              config={config}
              className='h-48 w-full'
              range={[data.from, data.to]}
              weekStart='monday'
              cellSize={16}
              thresholds={ONLINE_THRESHOLDS}
            >
              <EChartsHeatmapChart.Cell dataKey='online' radius={3} gap={3} />
              <EChartsHeatmapChart.MonthLabel />
              <EChartsHeatmapChart.DayLabel />
              <EChartsHeatmapChart.Tooltip
                dateFormatter={weekdayDay}
                valueFormatter={(hours) => formatDuration(hours * 3600)}
              />
              <EChartsHeatmapChart.Legend lessLabel='0 h' moreLabel='24 h' />
            </EChartsHeatmapChart>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryView({ data }: { data: StoreHistory }) {
  const { online, orders, sales, currency } = data;
  const sales_by_day = new Map(data.sales_by_day.map((s) => [s.day, s]));
  const flow = new Map(orders.by_day.map((d) => [d.day, d]));
  const days = online.by_day.map((d) => ({
    ...d,
    flow: flow.get(d.day),
    sales: sales_by_day.get(d.day)
  }));

  const orderRows: BarRow[] = orders.by_day.map((d) => ({
    label: shortDay(d.day),
    value: d.orders,
    detail: `${d.orders} orders · ${d.completed} completed · ${d.cancelled} cancelled`
  }));
  const salesRows: BarRow[] = data.sales_by_day.map((d) => ({
    label: shortDay(d.day),
    value: Number(d.gross_sales),
    detail: `${formatMoney(d.gross_sales, currency)} · ${d.bills_count} bills`
  }));
  const completeRows: BarRow[] = orders.by_day.map((d) => ({
    label: shortDay(d.day),
    value: d.avg_complete_seconds === null ? null : Math.round(d.avg_complete_seconds / 60),
    detail:
      d.avg_complete_seconds === null
        ? 'No completed orders'
        : `${formatDuration(d.avg_complete_seconds)} on average`
  }));
  const hourRows: BarRow[] = data.hours.hours.map((h) => ({
    label: hourLabel(h.hour),
    value: Number(h.average),
    detail: `${formatMoney(h.average, currency)} a day on average`
  }));

  const types = Object.entries(sales.by_type).toSorted((a, b) => b[1].count - a[1].count);
  const typeOrders = types.reduce((sum, [, t]) => sum + t.count, 0);
  const gross = Number(sales.totals.gross_sales);

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
        <Stat
          label='Uptime'
          value={online.uptime_pct === null ? '—' : `${online.uptime_pct}%`}
          note={
            online.recorded_since
              ? `${formatDuration(online.online_seconds)} online, of all 24 hours a day`
              : 'Not recorded yet'
          }
        />
        <Stat label='Orders' value={String(orders.totals.orders)} />
        <Stat
          label='Cancelled'
          value={`${share(orders.totals.cancelled, orders.totals.orders)}%`}
          note={`${orders.totals.cancelled} orders`}
        />
        <Stat
          label='Time to complete'
          value={
            orders.totals.median_complete_seconds === null
              ? '—'
              : formatDuration(orders.totals.median_complete_seconds)
          }
          note='Median, order taken to completed'
        />
        <Stat
          label='Sales'
          value={formatMoney(sales.totals.gross_sales, currency)}
          note={change(gross, Number(sales.previous.gross_sales), data.days)}
        />
        <Stat
          label='Sync delay'
          value={
            orders.totals.avg_sync_seconds === null
              ? '—'
              : formatDuration(Math.max(60, orders.totals.avg_sync_seconds))
          }
          note='Average, POS change to cloud'
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <OnlineHeatmapCard data={data} />
        <BarsCard
          title='Orders'
          description='Orders taken each business day.'
          rows={orderRows}
          empty='No orders synced in this range.'
        />
        <BarsCard
          title='Sales'
          description='Paid bills each business day, before refunds.'
          rows={salesRows}
          empty='No paid bills in this range.'
        />
        <BarsCard
          title='Time to complete'
          description='Average minutes from order taken to completed.'
          rows={completeRows}
          empty='No completed orders in this range.'
        />
      </div>

      <BarsCard
        title='Sales by hour'
        description={
          data.hours.busiest_hour === null
            ? 'Average sales in each hour of a trading day.'
            : `Average sales in each hour of a trading day. Busiest: ${hourLabel(data.hours.busiest_hour)}.`
        }
        rows={hourRows}
        empty='No paid bills in this range.'
      />

      <div className='grid gap-4 lg:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Order status</CardTitle>
            <CardDescription>Where this range’s orders are now.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShareList
              rows={orders.by_status.map((s) => ({
                key: s.status,
                label: label(s.status),
                value: String(s.count),
                share: share(s.count, orders.totals.orders)
              }))}
              empty='No orders synced in this range.'
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Order types</CardTitle>
            <CardDescription>Paid bills by order type.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShareList
              rows={types.map(([type, t]) => ({
                key: type,
                label: label(type),
                value: `${t.count} · ${formatMoney(t.sales, currency)}`,
                share: share(t.count, typeOrders)
              }))}
              empty='No paid bills in this range.'
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Top items</CardTitle>
            <CardDescription>By revenue, cancelled orders left out.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShareList
              rows={data.top_items.items.map((i) => ({
                key: i.name,
                label: `${i.name} × ${Number(i.quantity)}`,
                value: formatMoney(i.revenue, currency),
                share: i.share
              }))}
              empty='No items sold in this range.'
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Day by day</CardTitle>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className='text-right'>Online</TableHead>
                <TableHead className='text-right'>Uptime</TableHead>
                <TableHead className='text-right'>Sessions</TableHead>
                <TableHead className='text-right'>Orders</TableHead>
                <TableHead className='text-right'>Cancelled</TableHead>
                <TableHead className='text-right'>Avg to complete</TableHead>
                <TableHead className='text-right'>Sales</TableHead>
                <TableHead className='text-right'>Bills</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.toReversed().map((d) => (
                <TableRow key={d.day}>
                  <TableCell className='text-sm whitespace-nowrap'>{shortDay(d.day)}</TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.recorded ? formatDuration(d.online_seconds) : '—'}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.uptime_pct === null ? '—' : `${d.uptime_pct}%`}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.recorded ? d.sessions : '—'}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.flow?.orders ?? 0}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.flow?.cancelled ?? 0}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.flow?.avg_complete_seconds == null
                      ? '—'
                      : formatDuration(d.flow.avg_complete_seconds)}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {formatMoney(d.sales?.gross_sales ?? 0, currency)}
                  </TableCell>
                  <TableCell className='text-right text-sm tabular-nums'>
                    {d.sales?.bills_count ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function StoreHistoryScreen({ id }: { id: string }) {
  const [days, setDays] = useQueryState('days', parseAsInteger.withDefault(30));
  const range = (RANGES as readonly number[]).includes(days) ? days : 30;
  const { data, isPending, error } = useStoreHistory(id, range);

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <Link
            href={`/dashboard/stores/${id}`}
            className='text-muted-foreground text-sm hover:underline'
          >
            ← Store details
          </Link>
          <h2 className='text-xl font-semibold'>
            {data?.store.name || 'Store'}
            {data?.store.status === 'suspended' && (
              <Badge variant='destructive' className='ml-2 align-middle'>
                Blocked
              </Badge>
            )}
          </h2>
          {data && (
            <p className='text-muted-foreground text-sm'>
              {shortDay(data.from)} – {shortDay(data.to)} · business days in {data.timezone}
            </p>
          )}
        </div>
        <div className='flex gap-1' role='group' aria-label='Range'>
          {RANGES.map((r) => (
            <Button
              key={r}
              size='sm'
              variant={r === range ? 'default' : 'outline'}
              aria-pressed={r === range}
              onClick={() => void setDays(r)}
            >
              {r} days
            </Button>
          ))}
        </div>
      </div>
      {!data ? (
        <QueryState isPending={isPending} error={error} rows={6} />
      ) : (
        <HistoryView data={data} />
      )}
    </div>
  );
}
