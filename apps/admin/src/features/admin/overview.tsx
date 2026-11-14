'use client';

import {
  IconAlarm,
  IconChevronRight,
  IconCreditCardOff,
  IconHourglassLow,
  IconLifebuoy,
  IconMinus,
  IconPlugConnectedX,
  IconTrendingDown,
  IconTrendingUp,
  IconWifi
} from '@tabler/icons-react';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import {
  type ChartConfig,
  EChartsAreaChart
} from '@/components/evilcharts/charts/echarts-area-chart';
import {
  tooltipIndicatorHtml,
  tooltipRow,
  tooltipShell
} from '@/components/evilcharts/ui/echarts-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAdmin, useCan } from '@/features/auth/use-admin';
import { formatDay, formatMoney, LICENCE_LABELS, licenceTone } from '@/lib/display';
import { DATE_PRESETS, istDay, shortDay } from '@/lib/ist-dates';
import { cn } from '@/lib/utils';
import { type Dashboard, useDashboard, useOverview } from './api';
import { QueryState } from './ui';

type Change = { current: number; previous: number };

/** Percentage change, or null when there is nothing to compare with. */
function percent({ current, previous }: Change): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function TrendIcon({ pct, className }: { pct: number | null; className?: string }) {
  if (pct === 0) return <IconMinus className={className} aria-hidden />;
  return pct === null || pct > 0 ? (
    <IconTrendingUp className={className} aria-hidden />
  ) : (
    <IconTrendingDown className={className} aria-hidden />
  );
}

function ChangeBadge({ change }: { change: Change }) {
  const pct = percent(change);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        pct === 0
          ? 'text-muted-foreground'
          : pct === null || pct > 0
            ? 'text-emerald-500'
            : 'text-rose-500'
      )}
    >
      <TrendIcon pct={pct} className='size-3.5' />
      {pct === null ? 'New' : `${pct > 0 ? '+' : ''}${pct}%`}
    </span>
  );
}

function changeSentence(change: Change, days: number) {
  const pct = percent(change);
  const before = `the ${days} ${days === 1 ? 'day' : 'days'} before`;
  if (pct === null) return `Up from none in ${before}`;
  if (pct === 0) return `Same as ${before}`;
  return `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on ${before}`;
}

function KpiCard({
  label,
  value,
  change,
  days,
  detail
}: {
  label: string;
  value: string;
  change: Change;
  days: number;
  detail: string;
}) {
  return (
    <div className='bg-card flex flex-col overflow-hidden rounded-xl border'>
      <div className='flex flex-col gap-2 p-5'>
        <div className='flex items-start justify-between gap-2'>
          <span className='text-muted-foreground text-sm'>{label}</span>
          <ChangeBadge change={change} />
        </div>
        <span className='text-3xl font-semibold tracking-tight tabular-nums'>{value}</span>
      </div>
      <div className='bg-muted/40 mt-auto flex flex-col gap-1 border-t p-5 text-sm'>
        <span className='flex items-start justify-between gap-2 font-medium'>
          {changeSentence(change, days)}
          <TrendIcon pct={percent(change)} className='mt-0.5 size-4 shrink-0' />
        </span>
        <span className='text-muted-foreground'>{detail}</span>
      </div>
    </div>
  );
}

function LiveTile({
  label,
  value,
  hint,
  icon: Icon,
  href,
  warn
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: typeof IconWifi;
  href?: string;
  warn?: boolean;
}) {
  const body = (
    <>
      <div className='flex items-start justify-between gap-2'>
        <span className='text-muted-foreground text-sm'>{label}</span>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            warn ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className='size-4.5' aria-hidden />
        </span>
      </div>
      <span className='text-2xl font-semibold tabular-nums'>{value}</span>
      <span className='text-muted-foreground text-xs'>{hint}</span>
    </>
  );
  const cls = 'bg-card flex flex-col gap-1 rounded-xl border p-4';
  return href ? (
    <Link href={href} className={cn(cls, 'hover:bg-muted/50 transition-colors')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className='bg-muted flex flex-wrap gap-1 self-start rounded-lg p-1'>
      {options.map((o) => (
        <button
          key={o.value}
          type='button'
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            o.value === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Metric = 'revenue' | 'cafe_sales' | 'new_stores' | 'new_leads';
const METRICS: Record<Metric, { label: string; money: boolean }> = {
  revenue: { label: 'Licence revenue', money: true },
  cafe_sales: { label: 'Café sales', money: true },
  new_stores: { label: 'New stores', money: false },
  new_leads: { label: 'New leads', money: false }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function TrendCard({ data }: { data: Dashboard }) {
  const available = (Object.keys(METRICS) as Metric[]).filter((m) => data[m] !== null);
  const [metric, setMetric] = useState<Metric>(
    () => available.find((m) => (data[m]?.current ?? 0) > 0) ?? available[0] ?? 'new_stores'
  );
  const meta = METRICS[metric];
  const totals = data[metric]!;
  const fmt = (n: number) => (meta.money ? formatMoney(n) : n.toLocaleString('en-IN'));
  const rows = data.series.map((s) => ({ label: shortDay(s.day), value: s[metric] ?? 0 }));
  const span = `${shortDay(data.range.from)} – ${shortDay(data.range.to)}`;
  const subtitle =
    metric === 'revenue' && data.revenue
      ? `${fmt(data.revenue.current)} from ${plural(data.revenue.payments, 'payment', 'payments')}, ${span}`
      : metric === 'cafe_sales'
        ? `${fmt(data.cafe_sales.current)} billed by ${plural(data.cafe_sales.stores, 'store', 'stores')}, ${span}`
        : `${fmt(totals.current)} in ${span}`;
  const config = {
    value: { label: meta.label, colors: { light: ['var(--chart-1)'], dark: ['var(--chart-1)'] } }
  } satisfies ChartConfig;

  const formatter = (params: unknown) => {
    const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number };
    const row = first?.dataIndex === undefined ? undefined : rows[first.dataIndex];
    if (!row) return '';
    return tooltipShell({
      label: row.label,
      body: tooltipRow({
        indicatorHtml: tooltipIndicatorHtml('value', 1),
        labelText: meta.label,
        valueText: fmt(row.value),
        dimmed: ''
      }),
      roundness: 'md',
      variant: 'default'
    });
  };

  return (
    <Card className='lg:col-span-2'>
      <CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div className='flex flex-col gap-1.5'>
          <CardTitle className='flex items-center gap-2 text-base'>
            {meta.label}
            <ChangeBadge change={totals} />
          </CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </div>
        <Segmented
          options={available.map((m) => ({ value: m, label: METRICS[m].label }))}
          value={metric}
          onChange={setMetric}
        />
      </CardHeader>
      <CardContent>
        <EChartsAreaChart
          key={metric}
          data={rows}
          config={config}
          xDataKey='label'
          className='aspect-auto h-72 w-full'
          curveType='monotone'
          chartOptions={{
            tooltip: {
              show: true,
              trigger: 'axis',
              confine: true,
              backgroundColor: 'transparent',
              borderWidth: 0,
              padding: 0,
              extraCssText: 'box-shadow:none;',
              formatter
            }
          }}
        >
          <EChartsAreaChart.Grid />
          <EChartsAreaChart.XAxis />
          <EChartsAreaChart.Area dataKey='value' variant='gradient' />
          <EChartsAreaChart.Tooltip />
        </EChartsAreaChart>
      </CardContent>
    </Card>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

function Row({
  href,
  name,
  detail,
  end
}: {
  href: string;
  name: string;
  detail: string;
  end: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className='hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5'
      >
        <span className='bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium'>
          {initials(name)}
        </span>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm font-medium'>{name}</span>
          <span className='text-muted-foreground truncate text-xs'>{detail}</span>
        </span>
        {end}
      </Link>
    </li>
  );
}

function RecentCard({ data }: { data: Dashboard }) {
  const payments = data.recent_payments;
  const [tab, setTab] = useState<'payments' | 'stores'>(
    payments && payments.length > 0 ? 'payments' : 'stores'
  );
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-2'>
        <div className='flex flex-col gap-1.5'>
          <CardTitle className='text-base'>
            {tab === 'payments' ? 'Recent payments' : 'Newest stores'}
          </CardTitle>
          <CardDescription>
            {tab === 'payments'
              ? 'Latest licence payments recorded.'
              : `${plural(data.live.stores, 'store', 'stores')} in all.`}
          </CardDescription>
        </div>
        <Link
          href='/dashboard/stores'
          className='text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-sm'
        >
          All
          <IconChevronRight className='size-4' aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {payments && (
          <Segmented
            options={[
              { value: 'payments', label: 'Payments' },
              { value: 'stores', label: 'New stores' }
            ]}
            value={tab}
            onChange={setTab}
          />
        )}
        {tab === 'payments' && payments ? (
          payments.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No payments recorded yet.</p>
          ) : (
            <ul className='flex flex-col'>
              {payments.map((p) => (
                <Row
                  key={p.id}
                  href={`/dashboard/stores/${p.store_id}`}
                  name={p.store_name || 'Unnamed store'}
                  detail={[
                    p.plan_name,
                    p.method === 'razorpay' ? 'Razorpay' : 'Manual',
                    formatDay(p.paid_at)
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  end={
                    <span className='text-sm font-medium text-emerald-500 tabular-nums'>
                      +{formatMoney(p.amount, p.currency)}
                    </span>
                  }
                />
              ))}
            </ul>
          )
        ) : data.newest_stores.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No stores yet.</p>
        ) : (
          <ul className='flex flex-col'>
            {data.newest_stores.map((s) => (
              <Row
                key={s.id}
                href={`/dashboard/stores/${s.id}`}
                name={s.name || 'Unnamed store'}
                detail={[s.phone, `Joined ${formatDay(s.created_at)}`].filter(Boolean).join(' · ')}
                end={
                  <Badge variant={licenceTone(s.licence)}>
                    {LICENCE_LABELS[s.licence ?? 'none'] ?? s.licence ?? 'No licence'}
                  </Badge>
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RangePicker({
  from,
  to,
  onChange
}: {
  from: string;
  to: string;
  onChange: (r: { from?: string; to?: string }) => void;
}) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      {DATE_PRESETS.map((p) => {
        const [f, t] = p.range();
        return (
          <Button
            key={p.label}
            size='sm'
            variant={from === f && to === t ? 'default' : 'outline'}
            onClick={() => onChange({ from: f, to: t })}
          >
            {p.label}
          </Button>
        );
      })}
      <div className='flex items-center gap-2'>
        <Input
          type='date'
          aria-label='From'
          className='h-8 w-auto'
          value={from}
          max={to}
          onChange={(e) => e.target.value && onChange({ from: e.target.value })}
        />
        <span className='text-muted-foreground text-sm'>to</span>
        <Input
          type='date'
          aria-label='To'
          className='h-8 w-auto'
          value={to}
          min={from}
          max={istDay()}
          onChange={(e) => e.target.value && onChange({ to: e.target.value })}
        />
      </div>
    </div>
  );
}

function FleetCards() {
  const { data } = useOverview();
  if (!data) return null;
  const licences = Object.entries(data.licences).toSorted((a, b) => b[1] - a[1]);
  return (
    <div className='grid gap-4 md:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Licences</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-2'>
          {licences.length === 0 && <p className='text-muted-foreground text-sm'>No stores yet.</p>}
          {licences.map(([status, n]) => (
            <Link
              key={status}
              href={`/dashboard/stores?licence=${status}`}
              className='hover:bg-muted flex items-center justify-between rounded-md px-2 py-1.5'
            >
              <Badge variant={licenceTone(status)}>{LICENCE_LABELS[status] ?? status}</Badge>
              <span className='tabular-nums'>{n}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>POS versions in use</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-2'>
          {data.versions.length === 0 && (
            <p className='text-muted-foreground text-sm'>No POS has connected yet.</p>
          )}
          {data.versions.map((v) => (
            <div key={v.version} className='flex items-center justify-between px-2 py-1.5 text-sm'>
              <span className='font-mono'>{v.version}</span>
              <span className='tabular-nums'>{v.count}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function OverviewScreen() {
  const { data: me } = useAdmin();
  const [range, setRange] = useQueryStates({
    from: parseAsString.withDefault(istDay(-29)),
    to: parseAsString.withDefault(istDay())
  });
  const valid = range.from <= range.to;
  const { data, isPending, error } = useDashboard(range.from, range.to, valid);
  const seesTickets = useCan('tickets.view');
  const sells = useCan('leads.edit');
  const firstName = me?.name.split(/\s+/)[0];

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
        <h1 className='text-2xl font-bold tracking-tight'>
          {firstName ? `Hi, ${firstName}, welcome back` : 'Welcome back'} 👋
        </h1>
        <RangePicker from={range.from} to={range.to} onChange={(r) => void setRange(r)} />
      </div>

      {!valid ? (
        <p className='text-destructive text-sm'>The start date must be on or before the end.</p>
      ) : !data ? (
        <QueryState isPending={isPending} error={error} rows={6} />
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            {data.revenue && (
              <KpiCard
                label='Licence revenue'
                value={formatMoney(data.revenue.current)}
                change={data.revenue}
                days={data.range.days}
                detail={`${formatMoney(data.revenue.previous)} in ${shortDay(data.range.previous_from)} – ${shortDay(data.range.previous_to)}`}
              />
            )}
            <KpiCard
              label='New stores'
              value={data.new_stores.current.toLocaleString('en-IN')}
              change={data.new_stores}
              days={data.range.days}
              detail={`${data.new_stores.on_trial} on a free trial now`}
            />
            <KpiCard
              label='Café sales on Restrovia'
              value={formatMoney(data.cafe_sales.current)}
              change={data.cafe_sales}
              days={data.range.days}
              detail={`${data.cafe_sales.bills.toLocaleString('en-IN')} bills · ${plural(data.cafe_sales.stores, 'store', 'stores')}`}
            />
            {data.new_leads && (
              <KpiCard
                label='New leads'
                value={data.new_leads.current.toLocaleString('en-IN')}
                change={data.new_leads}
                days={data.range.days}
                detail={`${data.new_leads.won} won · ${data.new_leads.lost} lost in this range`}
              />
            )}
          </div>

          <div className='grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6'>
            <LiveTile
              label='Online now'
              value={data.live.online}
              hint={`of ${plural(data.live.stores, 'store', 'stores')}`}
              icon={IconWifi}
              href='/dashboard/stores'
            />
            <LiveTile
              label='Offline over a day'
              value={data.live.offline_day}
              hint='Active stores not seen in 24 hours'
              icon={IconPlugConnectedX}
              href='/dashboard/stores?status=active'
              warn={data.live.offline_day > 0}
            />
            <LiveTile
              label='Trials ending'
              value={data.live.trials_ending}
              hint='In the next 7 days'
              icon={IconHourglassLow}
              href='/dashboard/stores?licence=trial'
              warn={data.live.trials_ending > 0}
            />
            <LiveTile
              label='Payment overdue'
              value={data.live.past_due}
              hint='Licences past due'
              icon={IconCreditCardOff}
              href='/dashboard/stores?licence=past_due'
              warn={data.live.past_due > 0}
            />
            <LiveTile
              label='Open tickets'
              value={data.live.open_tickets}
              hint='Open or in progress'
              icon={IconLifebuoy}
              href={seesTickets ? '/dashboard/tickets?status=open' : undefined}
              warn={data.live.open_tickets > 0}
            />
            {data.live.overdue_follow_ups !== null && (
              <LiveTile
                label='Overdue follow-ups'
                value={data.live.overdue_follow_ups}
                hint='Lead follow-ups past due'
                icon={IconAlarm}
                href={
                  sells ? '/dashboard/leads/tasks' : '/dashboard/leads?follow_up=overdue&stage='
                }
                warn={data.live.overdue_follow_ups > 0}
              />
            )}
          </div>

          <div className='grid gap-4 lg:grid-cols-3'>
            <TrendCard data={data} />
            <RecentCard data={data} />
          </div>

          <FleetCards />
        </>
      )}
    </div>
  );
}
