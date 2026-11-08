'use client';

import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TwoFactorPrompt } from '@/features/account/two-factor-prompt';
import { errorMessage } from '@/lib/api-client';
import {
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

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function Delta({
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

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
const chartConfig = {
  sales: { label: 'Sales', color: 'var(--primary)' },
  last_week: { label: 'Same day last week', color: 'var(--muted-foreground)' }
} satisfies ChartConfig;

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
            <ChartContainer
              config={chartConfig}
              className='h-60'
              style={{ minWidth: shown.length * 36 }}
            >
              <BarChart data={shown} margin={{ left: 0, right: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey='label' tickLine={false} axisLine={false} fontSize={11} />
                <YAxis hide />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <span className='flex w-full justify-between gap-3'>
                          <span className='text-muted-foreground'>
                            {chartConfig[name as keyof typeof chartConfig]?.label}
                          </span>
                          <span className='font-medium tabular-nums'>
                            {formatMoney(Number(value), currency)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey='last_week'
                  fill='var(--color-last_week)'
                  fillOpacity={0.35}
                  radius={3}
                />
                <Bar dataKey='sales' fill='var(--color-sales)' radius={3} />
              </BarChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SalesByType({ data }: { data: Dashboard }) {
  const types = Object.entries(data.by_type).sort(
    (a, b) => Number(b[1].sales) - Number(a[1].sales)
  );
  const total = types.reduce((sum, [, t]) => sum + Number(t.sales), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by order type</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {types.length === 0 && <p className='text-muted-foreground text-sm'>No paid bills yet.</p>}
        {types.map(([type, t]) => {
          const pct = total ? Math.round((Number(t.sales) / total) * 100) : 0;
          return (
            <div key={type} className='flex flex-col gap-1 text-sm'>
              <div className='flex justify-between gap-2'>
                <span>
                  {orderTypeLabel(type)}{' '}
                  <span className='text-muted-foreground'>
                    · {t.count} {t.count === 1 ? 'bill' : 'bills'}
                  </span>
                </span>
                <span className='font-medium tabular-nums'>
                  {formatMoney(t.sales, data.store.currency)}
                </span>
              </div>
              <div className='bg-muted h-2 overflow-hidden rounded-full'>
                <div className='bg-primary h-full rounded-full' style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
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
        <SalesByType data={data} />
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
