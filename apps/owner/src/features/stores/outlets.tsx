'use client';

import Link from 'next/link';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { errorMessage } from '@/lib/api-client';
import { formatMoney } from '@/lib/display';
import { outletsCsvUrl, useOutlets, useStores, type OutletRow, type OutletsReport } from './api';
import { RangePicker, daysIn, rangeLabel, usePrintInLight, useReportRange } from './report-range';
import { MAX_LONG_DAYS, Toolbar } from './report-views';
import { OnlineDot, onlineText } from './store-switcher';
import { Delta } from './today';

const SORTS = ['name', 'today', 'sales', 'bills', 'avg_bill'] as const;
type Sort = (typeof SORTS)[number];
const SORT_LABELS: Record<Sort, string> = {
  name: 'Name',
  today: 'Sales today',
  sales: 'Sales in period',
  bills: 'Bills in period',
  avg_bill: 'Average bill'
};

const sortValue = (o: OutletRow, sort: Sort): number => {
  switch (sort) {
    case 'today':
      return Number(o.today.gross_sales);
    case 'sales':
      return Number(o.range.gross_sales);
    case 'bills':
      return o.range.bills_count;
    case 'avg_bill':
      return Number(o.range.avg_bill);
    case 'name':
      return 0;
  }
};

function sorted(outlets: OutletRow[], sort: Sort): OutletRow[] {
  if (sort === 'name') return outlets;
  return outlets.toSorted((a, b) => sortValue(b, sort) - sortValue(a, sort));
}

/** The day the newest café is on; the period presets count back from it. */
const latestDay = (days: string[]) => days.reduce<string | undefined>((a, b) => (!a || b > a ? b : a), undefined);

function Tiles({
  total,
  isToday,
  showCurrency
}: {
  total: OutletsReport['totals'][number];
  /** With only today picked, a "sales in period" tile would repeat the first one. */
  isToday: boolean;
  showCurrency: boolean;
}) {
  const c = total.currency;
  const when = isToday ? 'today' : 'in period';
  const tiles = [
    {
      title: 'Sales today',
      value: formatMoney(total.today.gross_sales, c),
      note: (
        <Delta
          now={total.today.gross_sales}
          before={total.last_week.gross_sales}
          label='vs same time last week'
        />
      )
    },
    isToday
      ? { title: 'Open orders now', value: String(total.open_orders), note: null }
      : { title: 'Sales in period', value: formatMoney(total.range.gross_sales, c), note: null },
    { title: `Bills ${when}`, value: String(total.range.bills_count), note: null },
    { title: `Average bill ${when}`, value: formatMoney(total.range.avg_bill, c), note: null }
  ];
  return (
    <section className='flex flex-col gap-2' aria-label={`Totals in ${c}`}>
      {showCurrency && (
        <h2 className='text-muted-foreground text-sm font-medium'>
          {c} · {total.outlets} {total.outlets === 1 ? 'café' : 'cafés'}
        </h2>
      )}
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {tiles.map((t) => (
          <Card key={t.title} className='gap-2'>
            <CardHeader>
              <CardDescription className='truncate'>{t.title}</CardDescription>
              <CardTitle className='text-xl tabular-nums sm:text-2xl'>{t.value}</CardTitle>
            </CardHeader>
            {t.note && <CardContent className='text-xs'>{t.note}</CardContent>}
          </Card>
        ))}
      </div>
    </section>
  );
}

function CafeName({ outlet }: { outlet: OutletRow }) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <span className='flex items-center gap-2'>
        <OnlineDot online={outlet.online} />
        <Link
          href={`/dashboard/${outlet.id}`}
          className='truncate font-medium underline-offset-4 hover:underline'
        >
          {outlet.name || 'Unnamed café'}
        </Link>
        {outlet.role === 'manager' && (
          <Badge variant='outline' className='text-[10px]'>
            Manager
          </Badge>
        )}
      </span>
      {!outlet.online && (
        <span className='text-muted-foreground pl-4 text-xs'>{onlineText(outlet)}</span>
      )}
    </div>
  );
}

function OutletsTable({ report, sort }: { report: OutletsReport; sort: Sort }) {
  const outlets = sorted(report.outlets, sort);
  return (
    <Card className='hidden py-0 md:flex print:flex'>
      <CardContent className='px-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='pl-4'>Café</TableHead>
              <TableHead className='text-right'>Sales today</TableHead>
              <TableHead className='text-right'>Open orders</TableHead>
              <TableHead className='text-right'>Sales in period</TableHead>
              <TableHead className='text-right'>Bills</TableHead>
              <TableHead className='pr-4 text-right'>Average bill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outlets.map((o) => (
              <TableRow key={o.id} className='tabular-nums'>
                <TableCell className='max-w-64 pl-4'>
                  <CafeName outlet={o} />
                </TableCell>
                <TableCell className='text-right'>
                  <div>{formatMoney(o.today.gross_sales, o.currency)}</div>
                  <div className='text-xs'>
                    <Delta
                      now={o.today.gross_sales}
                      before={o.last_week.gross_sales}
                      label='vs last week'
                    />
                  </div>
                </TableCell>
                <TableCell className='text-right'>{o.open_orders}</TableCell>
                <TableCell className='text-right'>
                  {formatMoney(o.range.gross_sales, o.currency)}
                </TableCell>
                <TableCell className='text-right'>{o.range.bills_count}</TableCell>
                <TableCell className='pr-4 text-right'>
                  {formatMoney(o.range.avg_bill, o.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {report.totals.map((t) => (
              <TableRow key={t.currency} className='tabular-nums'>
                <TableCell className='pl-4'>
                  Total{report.totals.length > 1 ? ` (${t.currency})` : ''}
                </TableCell>
                <TableCell className='text-right'>
                  {formatMoney(t.today.gross_sales, t.currency)}
                </TableCell>
                <TableCell className='text-right'>{t.open_orders}</TableCell>
                <TableCell className='text-right'>
                  {formatMoney(t.range.gross_sales, t.currency)}
                </TableCell>
                <TableCell className='text-right'>{t.range.bills_count}</TableCell>
                <TableCell className='pr-4 text-right'>
                  {formatMoney(t.range.avg_bill, t.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function OutletCards({ report, sort }: { report: OutletsReport; sort: Sort }) {
  return (
    <ul className='flex flex-col gap-3 md:hidden print:hidden'>
      {sorted(report.outlets, sort).map((o) => (
        <li key={o.id}>
          <Card className='gap-3 py-4'>
            <CardHeader className='px-4'>
              <CafeName outlet={o} />
            </CardHeader>
            <CardContent className='grid grid-cols-2 gap-x-4 gap-y-2 px-4 text-sm tabular-nums'>
              <div>
                <div className='text-muted-foreground text-xs'>Sales today</div>
                <div className='font-medium'>{formatMoney(o.today.gross_sales, o.currency)}</div>
                <div className='text-xs'>
                  <Delta
                    now={o.today.gross_sales}
                    before={o.last_week.gross_sales}
                    label='vs last week'
                  />
                </div>
              </div>
              <div>
                <div className='text-muted-foreground text-xs'>Sales in period</div>
                <div className='font-medium'>{formatMoney(o.range.gross_sales, o.currency)}</div>
                <div className='text-muted-foreground text-xs'>
                  {o.range.bills_count} bills · avg {formatMoney(o.range.avg_bill, o.currency)}
                </div>
              </div>
              <div className='text-muted-foreground col-span-2 text-xs'>
                {o.open_orders} open {o.open_orders === 1 ? 'order' : 'orders'}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function OutletsScreen() {
  usePrintInLight();
  const { data: stores } = useStores();
  const today = latestDay(stores?.map((s) => s.today.business_date) ?? []);
  const period = useReportRange(today, 'today');
  const [sort, setSort] = useQueryState('sort', parseAsStringLiteral(SORTS).withDefault('name'));
  const tooLong = !!period && daysIn(period.range) > MAX_LONG_DAYS;
  const { data: report, error, isPending } = useOutlets(period && !tooLong ? period.range : null);

  if (!period) return <Skeleton className='h-64' role='status' aria-label='Loading outlets' />;
  const isToday = period.range.from === today && period.range.to === today;

  return (
    <div className='flex flex-col gap-4'>
      <div className='hidden print:block'>
        <p className='text-lg font-semibold'>All outlets</p>
        <p className='text-sm'>{rangeLabel(period.range)}</p>
      </div>

      <RangePicker state={period} />

      {tooLong ? (
        <p role='status' className='bg-muted/50 rounded-lg border px-3 py-2 text-sm'>
          This page covers up to two years. Pick a shorter period.
        </p>
      ) : error ? (
        <p role='alert' className='text-destructive text-sm'>
          {errorMessage(error)}
        </p>
      ) : isPending || !report ? (
        <Skeleton className='h-64' role='status' aria-label='Loading outlets' />
      ) : (
        <>
          {report.totals.map((t) => (
            <Tiles
              key={t.currency}
              total={t}
              isToday={isToday}
              showCurrency={report.totals.length > 1}
            />
          ))}
          <Toolbar csvHref={report.outlets.length ? outletsCsvUrl(period.range) : undefined}>
            <NativeSelect
              aria-label='Sort by'
              value={sort}
              onChange={(e) => void setSort(e.target.value as Sort)}
            >
              {SORTS.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  Sort: {SORT_LABELS[s]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Toolbar>
          <OutletsTable report={report} sort={sort} />
          <OutletCards report={report} sort={sort} />
          <p className='text-muted-foreground text-xs'>
            Each café counts the period in its own business days. Sales are paid bills, before
            refunds. “vs last week” compares today with the same day last week up to this time.
          </p>
        </>
      )}
    </div>
  );
}
