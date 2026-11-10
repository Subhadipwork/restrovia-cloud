'use client';

import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addDays, formatDay } from '@/lib/display';
import { useStores, type ReportRange } from './api';
import {
  ChecksView,
  daysIn,
  HoursView,
  ItemsView,
  MAX_DAYS,
  MAX_LONG_DAYS,
  PaymentsView,
  SalesView
} from './report-views';

const TABS = ['sales', 'items', 'hours', 'payments', 'checks'] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  sales: 'Sales',
  items: 'Items',
  hours: 'Hours',
  payments: 'Payments',
  checks: 'Checks'
};
const PRESETS = ['today', 'yesterday', 'last7', 'last30', 'month', 'last_month'] as const;
type Preset = (typeof PRESETS)[number];
const PRESET_LABELS: Record<Preset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  month: 'This month',
  last_month: 'Last month'
};

function presetRange(preset: Preset, today: string): ReportRange {
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'last_month':
      return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
  }
}

/** A dark page prints as pale text on white paper, so printing switches to the light theme. */
function usePrintInLight() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains('dark');
      root.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) root.classList.add('dark');
      wasDark = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

export function ReportsScreen({ storeId }: { storeId: string }) {
  usePrintInLight();
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const today = store?.today.business_date;
  // A preset stays relative ("last 7 days" next week too); picked dates stay as picked.
  const [params, setParams] = useQueryStates({
    tab: parseAsStringLiteral(TABS).withDefault('sales'),
    range: parseAsStringLiteral(PRESETS).withDefault('last7'),
    from: parseAsString,
    to: parseAsString
  });
  if (!store || !today) return null;

  const custom = !!(params.from && params.to);
  const range: ReportRange =
    custom && params.from! <= params.to! && params.to! <= today
      ? { from: params.from!, to: params.to! }
      : presetRange(params.range, today);
  const days = daysIn(range);
  const maxDays = params.tab === 'sales' ? MAX_LONG_DAYS : MAX_DAYS;
  const view = { storeId, range, currency: store.currency, timeZone: store.timezone };
  const rangeLabel =
    range.from === range.to
      ? formatDay(range.from)
      : `${formatDay(range.from)} – ${formatDay(range.to)}`;

  return (
    <div className='flex flex-col gap-4'>
      <div className='hidden print:block'>
        <p className='text-lg font-semibold'>
          {store.name} · {TAB_LABELS[params.tab]} report
        </p>
        <p className='text-sm'>
          {rangeLabel} · amounts in {store.currency}
        </p>
      </div>

      <div className='grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center print:hidden'>
        <NativeSelect
          aria-label='Period'
          className='col-span-2 w-full sm:w-fit'
          value={custom ? 'custom' : params.range}
          onChange={(e) => {
            const value = e.target.value as Preset | 'custom';
            if (value === 'custom') void setParams({ from: range.from, to: range.to });
            else void setParams({ range: value, from: null, to: null });
          }}
        >
          {PRESETS.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {PRESET_LABELS[p]}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value='custom'>Custom dates</NativeSelectOption>
        </NativeSelect>
        <Input
          type='date'
          aria-label='From'
          className='sm:w-auto'
          value={range.from}
          max={today}
          onChange={(e) => {
            const from = e.target.value;
            if (from) void setParams({ from, to: from > range.to ? from : range.to });
          }}
        />
        <Input
          type='date'
          aria-label='To'
          className='sm:w-auto'
          value={range.to}
          min={range.from}
          max={today}
          onChange={(e) => {
            const to = e.target.value;
            if (to) void setParams({ from: to < range.from ? to : range.from, to });
          }}
        />
        <span className='text-muted-foreground col-span-2 text-sm'>
          {days === 1 ? rangeLabel : `${days} days`}
        </span>
      </div>

      <Tabs
        value={params.tab}
        onValueChange={(tab) => void setParams({ tab: tab as (typeof TABS)[number] })}
        className='gap-4'
      >
        <TabsList className='w-full sm:w-fit print:hidden'>
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className='px-2 sm:px-3'>
              {TAB_LABELS[tab]}
            </TabsTrigger>
          ))}
        </TabsList>
        {days > maxDays ? (
          <p role='status' className='bg-muted/50 rounded-lg border px-3 py-2 text-sm'>
            {params.tab === 'sales'
              ? 'Sales reports cover up to two years. Pick a shorter period.'
              : `This report covers up to ${MAX_DAYS} days. Pick a shorter period.`}
          </p>
        ) : (
          <>
            <TabsContent value='sales'>
              <SalesView {...view} />
            </TabsContent>
            <TabsContent value='items'>
              <ItemsView {...view} />
            </TabsContent>
            <TabsContent value='hours'>
              <HoursView {...view} />
            </TabsContent>
            <TabsContent value='payments'>
              <PaymentsView {...view} />
            </TabsContent>
            <TabsContent value='checks'>
              <ChecksView {...view} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
