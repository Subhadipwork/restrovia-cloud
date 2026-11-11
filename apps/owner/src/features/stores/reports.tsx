'use client';

import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStores } from './api';
import { RangePicker, daysIn, rangeLabel, usePrintInLight, useReportRange } from './report-range';
import {
  ChecksView,
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

export function ReportsScreen({ storeId }: { storeId: string }) {
  usePrintInLight();
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const [tab, setTab] = useQueryState('tab', parseAsStringLiteral(TABS).withDefault('sales'));
  const period = useReportRange(store?.today.business_date, 'last7');
  if (!store || !period) return null;

  const { range } = period;
  const days = daysIn(range);
  const maxDays = tab === 'sales' ? MAX_LONG_DAYS : MAX_DAYS;
  const view = { storeId, range, currency: store.currency, timeZone: store.timezone };

  return (
    <div className='flex flex-col gap-4'>
      <div className='hidden print:block'>
        <p className='text-lg font-semibold'>
          {store.name} · {TAB_LABELS[tab]} report
        </p>
        <p className='text-sm'>
          {rangeLabel(range)} · amounts in {store.currency}
        </p>
      </div>

      <RangePicker state={period} />

      <Tabs
        value={tab}
        onValueChange={(value) => void setTab(value as (typeof TABS)[number])}
        className='gap-4'
      >
        <TabsList className='w-full sm:w-fit print:hidden'>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className='px-2 sm:px-3'>
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {days > maxDays ? (
          <p role='status' className='bg-muted/50 rounded-lg border px-3 py-2 text-sm'>
            {tab === 'sales'
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
