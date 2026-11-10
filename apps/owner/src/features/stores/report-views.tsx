'use client';

import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useDebounce } from '@/hooks/use-debounce';
import { errorMessage } from '@/lib/api-client';
import { formatDay, formatMoney, formatMonth, formatShortDay, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import {
  reportCsvUrl,
  useHoursReport,
  useItemsReport,
  usePaymentsReport,
  useSalesReport,
  type PaymentsReport,
  type ReportGroup,
  type ReportRange,
  type SalesReport
} from './api';
import { Delta, hourLabel, SalesByType } from './today';

/** The API's limits: by day, items, hours and payments; and by week or month. */
export const MAX_DAYS = 92;
export const MAX_LONG_DAYS = 731;
const GROUPS = ['day', 'week', 'month'] as const;
const SORTS = ['revenue', 'quantity'] as const;

export const daysIn = (range: ReportRange) =>
  Math.round(
    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000
  ) + 1;

type ViewProps = { storeId: string; range: ReportRange; currency: string; timeZone: string };

const formatQuantity = (quantity: string) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(quantity));

function Loading() {
  return <Skeleton className='h-64' role='status' aria-label='Loading report' />;
}

/** The view's own controls on the left; the file and print buttons on the right. */
function Toolbar({
  csvHref,
  children
}: {
  /** Undefined while there is nothing to download. */
  csvHref: string | undefined;
  children?: React.ReactNode;
}) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-2 print:hidden'>
      <div className='flex flex-wrap items-center gap-2'>{children}</div>
      <div className='flex gap-2'>
        {csvHref ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={<a href={csvHref} download aria-label='Download CSV' />}
          >
            Download CSV
          </Button>
        ) : (
          <Button variant='outline' disabled>
            Download CSV
          </Button>
        )}
        <Button variant='outline' onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}

function ShareBar({ percent }: { percent: number }) {
  return (
    <div className='bg-muted h-2 overflow-hidden rounded-full'>
      <div
        className='bg-primary h-full rounded-full print:border print:border-black'
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

function MoneyTooltip({ currency, label }: { currency: string; label: string }) {
  return (
    <ChartTooltip
      content={
        <ChartTooltipContent
          formatter={(value) => (
            <span className='flex w-full justify-between gap-3'>
              <span className='text-muted-foreground'>{label}</span>
              <span className='font-medium tabular-nums'>
                {formatMoney(Number(value), currency)}
              </span>
            </span>
          )}
        />
      }
    />
  );
}

const salesChart = { sales: { label: 'Sales', color: 'var(--primary)' } } satisfies ChartConfig;

function periodLabel(p: SalesReport['periods'][number], group: ReportGroup): string {
  if (group === 'day') return formatDay(p.start);
  if (group === 'month') return `${formatMonth(p.start)}${p.partial ? ' (part)' : ''}`;
  return `${formatShortDay(p.start)} – ${formatShortDay(p.end)}`;
}

function SalesStat({
  title,
  value,
  now,
  before,
  label
}: {
  title: string;
  value: string;
  now: string | number;
  before: string | number;
  label: string;
}) {
  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl tabular-nums sm:text-3xl'>{value}</CardTitle>
      </CardHeader>
      <CardContent className='text-xs'>
        <Delta now={now} before={before} label={label} />
      </CardContent>
    </Card>
  );
}

export function SalesView({ storeId, range, currency }: ViewProps) {
  const days = daysIn(range);
  const [picked, setGroup] = useQueryState('group', parseAsStringLiteral(GROUPS));
  const byDayAllowed = days <= MAX_DAYS;
  const group: ReportGroup =
    picked && (picked !== 'day' || byDayAllowed)
      ? picked
      : days <= 31
        ? 'day'
        : byDayAllowed
          ? 'week'
          : 'month';
  const { data, error, isPending, isFetching } = useSalesReport(storeId, range, group);

  const toolbar = (
    <Toolbar csvHref={data && reportCsvUrl(storeId, 'sales', { ...range, group })}>
      <NativeSelect
        aria-label='Group by'
        value={group}
        onChange={(e) => void setGroup(e.target.value as ReportGroup)}
      >
        <NativeSelectOption value='day' disabled={!byDayAllowed}>
          By day
        </NativeSelectOption>
        <NativeSelectOption value='week'>By week</NativeSelectOption>
        <NativeSelectOption value='month'>By month</NativeSelectOption>
      </NativeSelect>
    </Toolbar>
  );
  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) {
    return (
      <div className='flex flex-col gap-4'>
        {toolbar}
        <Loading />
      </div>
    );
  }

  const { totals, previous } = data;
  const before = `vs the ${days === 1 ? 'day' : `${days} days`} before`;
  const bars = data.periods.map((p) => ({
    // A week is labelled by the day it starts on.
    label: group === 'month' ? formatMonth(p.start) : formatShortDay(p.start),
    sales: Number(p.gross_sales)
  }));

  return (
    <div className={cn('flex flex-col gap-4', isFetching && 'opacity-90')}>
      {toolbar}
      <div className='grid gap-4 sm:grid-cols-3'>
        <SalesStat
          title='Sales'
          value={formatMoney(totals.gross_sales, currency)}
          now={totals.gross_sales}
          before={previous.gross_sales}
          label={before}
        />
        <SalesStat
          title='Paid bills'
          value={String(totals.bills_count)}
          now={totals.bills_count}
          before={previous.bills_count}
          label={before}
        />
        <SalesStat
          title='Average bill'
          value={formatMoney(totals.avg_bill, currency)}
          now={totals.avg_bill}
          before={previous.avg_bill}
          label={before}
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-3'>
        <Card className='min-w-0 lg:col-span-2'>
          <CardHeader>
            <CardTitle>Sales by {group}</CardTitle>
            {group === 'week' && <CardDescription>Weeks run Monday to Sunday.</CardDescription>}
          </CardHeader>
          <CardContent>
            {Number(totals.gross_sales) === 0 ? (
              <p className='text-muted-foreground text-sm'>No paid bills in this period.</p>
            ) : (
              <div className='-mx-2 overflow-x-auto px-2'>
                <ChartContainer
                  config={salesChart}
                  className='aspect-auto h-60 w-full'
                  style={{ minWidth: bars.length * 28 }}
                >
                  <BarChart data={bars} margin={{ left: 0, right: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey='label' tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis hide />
                    <MoneyTooltip currency={currency} label='Sales' />
                    <Bar dataKey='sales' fill='var(--color-sales)' radius={3} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <SalesByType byType={data.by_type} currency={currency} />
      </div>

      <Card className='py-0'>
        <CardContent className='px-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{group === 'day' ? 'Day' : group === 'week' ? 'Week' : 'Month'}</TableHead>
                <TableHead className='text-right'>Bills</TableHead>
                <TableHead className='hidden text-right sm:table-cell print:table-cell'>
                  Orders
                </TableHead>
                <TableHead className='hidden text-right md:table-cell print:table-cell'>
                  Tax
                </TableHead>
                <TableHead className='hidden text-right md:table-cell print:table-cell'>
                  Discount
                </TableHead>
                <TableHead className='hidden text-right sm:table-cell print:table-cell'>
                  Average bill
                </TableHead>
                <TableHead className='text-right'>Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.periods.map((p) => (
                <TableRow key={p.start} className='tabular-nums'>
                  <TableCell>{periodLabel(p, group)}</TableCell>
                  <TableCell className='text-right'>{p.bills_count}</TableCell>
                  <TableCell className='hidden text-right sm:table-cell print:table-cell'>
                    {p.orders_count}
                    {p.cancelled_count > 0 && (
                      <span className='text-muted-foreground'>
                        {' '}
                        +{p.cancelled_count} cancelled
                      </span>
                    )}
                  </TableCell>
                  <TableCell className='hidden text-right md:table-cell print:table-cell'>
                    {formatMoney(p.tax_total, currency)}
                  </TableCell>
                  <TableCell className='hidden text-right md:table-cell print:table-cell'>
                    {formatMoney(p.discount_total, currency)}
                  </TableCell>
                  <TableCell className='hidden text-right sm:table-cell print:table-cell'>
                    {formatMoney(p.avg_bill, currency)}
                  </TableCell>
                  <TableCell className='text-right font-medium'>
                    {formatMoney(p.gross_sales, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className='tabular-nums'>
                <TableCell>Total</TableCell>
                <TableCell className='text-right'>{totals.bills_count}</TableCell>
                <TableCell className='hidden text-right sm:table-cell print:table-cell'>
                  {totals.orders_count}
                </TableCell>
                <TableCell className='hidden text-right md:table-cell print:table-cell'>
                  {formatMoney(totals.tax_total, currency)}
                </TableCell>
                <TableCell className='hidden text-right md:table-cell print:table-cell'>
                  {formatMoney(totals.discount_total, currency)}
                </TableCell>
                <TableCell className='hidden text-right sm:table-cell print:table-cell'>
                  {formatMoney(totals.avg_bill, currency)}
                </TableCell>
                <TableCell className='text-right'>
                  {formatMoney(totals.gross_sales, currency)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <p className='text-muted-foreground text-xs'>
        Net of tax {formatMoney(totals.net_sales, currency)} · tax{' '}
        {formatMoney(totals.tax_total, currency)} · discounts{' '}
        {formatMoney(totals.discount_total, currency)}
        {totals.cancelled_count > 0 && ` · ${totals.cancelled_count} cancelled orders`}. Sales count
        bills on the day they are paid, before refunds.
      </p>
    </div>
  );
}

export function ItemsView({ storeId, range, currency }: ViewProps) {
  const [sort, setSort] = useQueryState('sort', parseAsStringLiteral(SORTS).withDefault('revenue'));
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 400) || undefined;
  const { data, error, isPending, isFetching } = useItemsReport(storeId, range, sort, q);

  return (
    <div className={cn('flex flex-col gap-4', isFetching && 'opacity-90')}>
      <Toolbar csvHref={data && reportCsvUrl(storeId, 'items', { ...range, sort, q })}>
        <Input
          type='search'
          aria-label='Search items'
          placeholder='Search items'
          className='w-44'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect
          aria-label='Sort by'
          value={sort}
          onChange={(e) => void setSort(e.target.value as (typeof SORTS)[number])}
        >
          <NativeSelectOption value='revenue'>Highest sales</NativeSelectOption>
          <NativeSelectOption value='quantity'>Most sold</NativeSelectOption>
        </NativeSelect>
      </Toolbar>

      {error ? (
        <p className='text-destructive text-sm'>{errorMessage(error)}</p>
      ) : isPending || !data ? (
        <Loading />
      ) : (
        <>
          <p className='text-sm'>
            <span className='font-medium'>
              {data.totals.products} {data.totals.products === 1 ? 'item' : 'items'}
            </span>{' '}
            · {formatQuantity(data.totals.quantity)} sold ·{' '}
            {formatMoney(data.totals.revenue, currency)}
          </p>
          <Card className='py-0'>
            <CardContent className='px-0'>
              {data.items.length === 0 ? (
                <p className='text-muted-foreground p-8 text-center text-sm'>
                  {q ? 'No items match.' : 'Nothing was sold in this period.'}
                </p>
              ) : (
                <ol className='divide-y'>
                  {data.items.map((item, i) => (
                    <li key={item.name} className='flex flex-col gap-1.5 px-4 py-3'>
                      <div className='flex items-baseline justify-between gap-3'>
                        <span className='min-w-0 truncate font-medium'>
                          <span className='text-muted-foreground tabular-nums'>{i + 1}.</span>{' '}
                          {item.name}
                        </span>
                        <span className='shrink-0 font-semibold tabular-nums'>
                          {formatMoney(item.revenue, currency)}
                        </span>
                      </div>
                      <div className='text-muted-foreground flex justify-between text-xs tabular-nums'>
                        <span>{formatQuantity(item.quantity)} sold</span>
                        <span>{item.share}% of sales</span>
                      </div>
                      <ShareBar percent={item.share} />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <p className='text-muted-foreground text-xs'>
            {data.totals.products > data.items.length &&
              !q &&
              `Showing the top ${data.items.length}. `}
            Items count on the day they were ordered; voided items and cancelled orders are left
            out.
          </p>
        </>
      )}
    </div>
  );
}

const hoursChart = { value: { label: 'Sales', color: 'var(--primary)' } } satisfies ChartConfig;

export function HoursView({ storeId, range, currency }: ViewProps) {
  const [measure, setMeasure] = useState<'sales' | 'average'>('sales');
  const { data, error, isPending, isFetching } = useHoursReport(storeId, range);
  const toolbar = (
    <Toolbar csvHref={data && reportCsvUrl(storeId, 'hours', range)}>
      <NativeSelect
        aria-label='Show'
        value={measure}
        onChange={(e) => setMeasure(e.target.value as 'sales' | 'average')}
      >
        <NativeSelectOption value='sales'>Total sales</NativeSelectOption>
        <NativeSelectOption value='average'>Average per day</NativeSelectOption>
      </NativeSelect>
    </Toolbar>
  );
  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) {
    return (
      <div className='flex flex-col gap-4'>
        {toolbar}
        <Loading />
      </div>
    );
  }

  const rows = data.hours.map((h) => ({ label: hourLabel(h.hour), value: Number(h[measure]) }));
  // Trim the quiet hours at both ends, keeping one on each side for context.
  const busy = rows.map((r, i) => (r.value ? i : -1)).filter((i) => i >= 0);
  const shown = busy.length
    ? rows.slice(Math.max(0, busy[0] - 1), Math.min(rows.length, busy[busy.length - 1] + 2))
    : [];
  const top = data.hours.find((h) => h.hour === data.busiest_hour);
  const total = Number(data.total_sales);

  return (
    <div className={cn('flex flex-col gap-4', isFetching && 'opacity-90')}>
      {toolbar}
      {top && (
        <Card className='py-4'>
          <CardContent className='text-sm'>
            Busiest hour:{' '}
            <span className='font-semibold'>
              {hourLabel(top.hour)} – {hourLabel((top.hour + 1) % 24)}
            </span>{' '}
            · {formatMoney(top.sales, currency)}
            {total > 0 && ` · ${Math.round((Number(top.sales) / total) * 100)}% of sales`}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Sales by hour</CardTitle>
          <CardDescription>
            {measure === 'sales'
              ? `Total over ${data.days_with_sales} ${data.days_with_sales === 1 ? 'day' : 'days'} with sales.`
              : 'Average over the days that had sales, so closed days don’t count.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No paid bills in this period.</p>
          ) : (
            <div className='-mx-2 overflow-x-auto px-2'>
              <ChartContainer
                config={hoursChart}
                className='aspect-auto h-60 w-full'
                style={{ minWidth: shown.length * 36 }}
              >
                <BarChart data={shown} margin={{ left: 0, right: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey='label' tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis hide />
                  <MoneyTooltip
                    currency={currency}
                    label={measure === 'sales' ? 'Sales' : 'Average'}
                  />
                  <Bar dataKey='value' fill='var(--color-value)' radius={3} />
                </BarChart>
              </ChartContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const PAYMENTS_UNAVAILABLE: Record<NonNullable<PaymentsReport['reason']>, string> = {
  offline:
    'The café computer is off or not connected. Payment totals come from the POS, so open this when the POS is on.',
  no_answer: 'The POS didn’t answer in time. Try again in a moment.',
  licence_inactive:
    'Your Restrovia licence has ended, so the POS no longer answers report requests. Contact Restrovia to renew.'
};

export function PaymentsView({ storeId, range, currency }: ViewProps) {
  const { data, error, isPending, isFetching, refetch } = usePaymentsReport(storeId, range);
  // The sales total for the same days, to set beside the payments total.
  const { data: sales } = useSalesReport(storeId, range, 'day');
  const toolbar = (
    <Toolbar csvHref={data?.available ? reportCsvUrl(storeId, 'payments', range) : undefined} />
  );
  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) {
    return (
      <div className='flex flex-col gap-4'>
        {toolbar}
        <Skeleton className='h-40' role='status' aria-label='Asking the POS for payment totals' />
      </div>
    );
  }

  if (!data.available) {
    return (
      <div className='flex flex-col gap-4'>
        {toolbar}
        <Card>
          <CardHeader>
            <CardTitle>Payment totals aren’t available right now</CardTitle>
            <CardDescription>{PAYMENTS_UNAVAILABLE[data.reason ?? 'no_answer']}</CardDescription>
          </CardHeader>
          {data.reason !== 'licence_inactive' && (
            <CardContent>
              <Button variant='outline' disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? 'Asking the POS…' : 'Try again'}
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', isFetching && 'opacity-90')}>
      {toolbar}
      <p className='text-sm'>
        <span className='font-medium'>{formatMoney(data.total, currency)} received</span>
        {sales && ` · sales for the same days ${formatMoney(sales.totals.gross_sales, currency)}`}
        <span className='text-muted-foreground'>
          {data.as_of && ` · from the POS ${timeAgo(data.as_of)}`}
        </span>
      </p>
      <Card className='py-0'>
        <CardContent className='px-0'>
          {data.methods.length === 0 ? (
            <p className='text-muted-foreground p-8 text-center text-sm'>
              No payments in this period.
            </p>
          ) : (
            <ul className='divide-y'>
              {data.methods.map((m) => (
                <li key={m.method} className='flex flex-col gap-1.5 px-4 py-3'>
                  <div className='flex items-baseline justify-between gap-3'>
                    <span className='min-w-0 truncate font-medium'>{m.method}</span>
                    <span className='shrink-0 font-semibold tabular-nums'>
                      {formatMoney(m.amount, currency)}
                    </span>
                  </div>
                  <div className='text-muted-foreground flex justify-between text-xs tabular-nums'>
                    <span>
                      {m.count} {m.count === 1 ? 'payment' : 'payments'}
                    </span>
                    <span>{m.percent}%</span>
                  </div>
                  <ShareBar percent={m.percent} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className='text-muted-foreground text-xs'>
        Payments are after refunds and follow the POS’s own calendar day, so the total can differ
        from sales.
      </p>
    </div>
  );
}
