'use client';

import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SeriesBarChart } from '@/components/series-bar-chart';
import { SharePieChart } from '@/components/share-pie-chart';
import { Skeleton } from '@/components/ui/skeleton';
import { TwoFactorPrompt } from '@/features/account/two-factor-prompt';
import { errorMessage } from '@/lib/api-client';
import {
  addDays,
  change,
  formatDateTime,
  formatDay,
  formatMoney,
  orderTypeLabel,
  timeAgo
} from '@/lib/display';
import { cn } from '@/lib/utils';
import { useDashboard, useStores, type Dashboard } from './api';
import { OfflineBanner } from './store-gate';

export function Delta({
  now,
  before,
  label
}: {
  now: string | number;
  before: string | number;
  label: string;
}) {
  const pct = change(now, before);
  if (pct === null) return <span className='text-muted-foreground'>— {label}</span>;
  return (
    <span
      className={cn(
        pct > 0 && 'text-emerald-600 dark:text-emerald-400',
        pct < 0 && 'text-red-600 dark:text-red-400'
      )}
    >
      {pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {Math.abs(pct)}% {label}
    </span>
  );
}

function Stat({
  title,
  value,
  pick,
  data
}: {
  title: string;
  value: string;
  pick: (t: Dashboard['totals']) => string | number;
  data: Dashboard;
}) {
  const sameTime = data.compare.yesterday.same_time ? ' at this time' : '';
  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl tabular-nums sm:text-3xl'>{value}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-0.5 text-xs'>
        <Delta
          now={pick(data.totals)}
          before={pick(data.compare.yesterday)}
          label={`vs yesterday${sameTime}`}
        />
        <Delta
          now={pick(data.totals)}
          before={pick(data.compare.last_week)}
          label={`vs last ${formatDay(data.compare.last_week.business_date).split(',')[0]}${sameTime}`}
        />
      </CardContent>
    </Card>
  );
}

export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
function HourlyChart({ data }: { data: Dashboard }) {
  const currency = data.store.currency;
  const rows = data.hourly.map((h) => ({
    label: hourLabel(h.hour),
    sales: Number(h.sales),
    last_week: Number(h.last_week)
  }));
  // Trim the quiet hours at both ends, keeping a few for context.
  const busy = rows.map((r, i) => (r.sales || r.last_week ? i : -1)).filter((i) => i >= 0);
  const shown = busy.length
    ? rows.slice(Math.max(0, busy[0] - 1), Math.min(rows.length, busy[busy.length - 1] + 2))
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by hour</CardTitle>
        <CardDescription>
          Bars: {formatDay(data.business_date)}. Grey: same day last week.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No paid bills on this day yet.</p>
        ) : (
          <div className='-mx-2 overflow-x-auto px-2'>
            <SeriesBarChart
              rows={shown}
              series={[
                { key: 'last_week', label: 'Same day last week', color: 'var(--muted-foreground)' },
                { key: 'sales', label: 'Sales', color: 'var(--primary)' }
              ]}
              formatValue={(n) => formatMoney(n, currency)}
              style={{ minWidth: shown.length * 36 }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SalesByType({
  byType,
  currency
}: {
  byType: Dashboard['by_type'];
  currency: string;
}) {
  const types = Object.entries(byType).sort((a, b) => Number(b[1].sales) - Number(a[1].sales));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by order type</CardTitle>
      </CardHeader>
      <CardContent>
        {types.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No paid bills yet.</p>
        ) : (
          <SharePieChart
            formatValue={(n) => formatMoney(n, currency)}
            rows={types.map(([type, t]) => ({
              key: type,
              label: orderTypeLabel(type),
              value: Number(t.sales),
              detail: `${t.count} ${t.count === 1 ? 'bill' : 'bills'}`
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function TodayScreen({ storeId }: { storeId: string }) {
  const [date, setDate] = useQueryState('date', parseAsString);
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const { data, error, isPending, isFetching } = useDashboard(storeId, date ?? undefined);

  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) {
    return (
      <div className='grid gap-4 sm:grid-cols-3' role='status' aria-label='Loading'>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className='h-32' />
        ))}
      </div>
    );
  }

  const day = data.business_date;
  const currency = data.store.currency;
  const today = store?.today.business_date ?? day;
  const go = (next: string) => void setDate(next >= today ? null : next);

  return (
    <div className={cn('flex flex-col gap-4', isFetching && 'opacity-90')}>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='outline'
          size='icon'
          aria-label='Previous day'
          onClick={() => go(addDays(day, -1))}
        >
          <Icons.chevronLeft />
        </Button>
        <Input
          type='date'
          aria-label='Business day'
          className='w-auto'
          value={day}
          max={today}
          onChange={(e) => e.target.value && go(e.target.value)}
        />
        <Button
          variant='outline'
          size='icon'
          aria-label='Next day'
          disabled={data.is_today}
          onClick={() => go(addDays(day, 1))}
        >
          <Icons.chevronRight />
        </Button>
        <span className='text-muted-foreground text-sm'>
          {data.is_today ? 'Today' : formatDay(day)}
          {data.data_as_of && ` · updated ${timeAgo(data.data_as_of)}`}
        </span>
      </div>

      {store && <OfflineBanner store={store} />}
      {data.licence.status === 'inactive' && (
        <div
          role='status'
          className='border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm'
        >
          Your Restrovia licence ended on{' '}
          {formatDateTime(data.licence.ends_at, data.store.timezone)}. History stays here; contact
          Restrovia to renew.
        </div>
      )}

      <div className='grid gap-4 sm:grid-cols-3'>
        <Stat
          title='Sales'
          value={formatMoney(data.totals.gross_sales, currency)}
          pick={(t) => t.gross_sales}
          data={data}
        />
        <Stat
          title='Orders'
          value={String(data.totals.orders_count)}
          pick={(t) => t.orders_count}
          data={data}
        />
        <Stat
          title='Average bill'
          value={formatMoney(data.totals.avg_bill, currency)}
          pick={(t) => t.avg_bill}
          data={data}
        />
      </div>

      {data.is_today && (
        <Card className='py-4'>
          <CardContent className='flex flex-wrap items-center justify-between gap-2'>
            <span className='flex items-center gap-2 text-sm'>
              <Badge variant={data.open_orders ? 'default' : 'secondary'}>{data.open_orders}</Badge>
              {data.open_orders === 1 ? 'order open right now' : 'orders open right now'}
            </span>
            <Button
              variant='outline'
              size='sm'
              nativeButton={false}
              render={<Link href={`/dashboard/${storeId}/live`} aria-label='See live orders' />}
            >
              See live orders
            </Button>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-4 lg:grid-cols-3'>
        <div className='min-w-0 lg:col-span-2'>
          <HourlyChart data={data} />
        </div>
        <SalesByType byType={data.by_type} currency={currency} />
      </div>

      <p className='text-muted-foreground text-xs'>
        {data.totals.bills_count} paid {data.totals.bills_count === 1 ? 'bill' : 'bills'} · net of
        tax {formatMoney(data.totals.net_sales, currency)}
        {data.totals.cancelled_count > 0 && ` · ${data.totals.cancelled_count} cancelled`}. Sales
        count bills when they are paid, like the POS sales report.
      </p>

      <TwoFactorPrompt />
    </div>
  );
}
