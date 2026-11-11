'use client';

import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { addDays, formatDay } from '@/lib/display';
import type { ReportRange } from './api';

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

export const daysIn = (range: ReportRange) =>
  Math.round(
    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000
  ) + 1;

export const rangeLabel = (range: ReportRange) =>
  range.from === range.to
    ? formatDay(range.from)
    : `${formatDay(range.from)} – ${formatDay(range.to)}`;

/** A dark page prints as pale text on white paper, so printing switches to the light theme. */
export function usePrintInLight() {
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

/**
 * The period in the address bar. A preset stays relative ("last 7 days" next week too); picked
 * dates stay as picked.
 */
export function useReportRange(today: string | undefined, fallback: Preset) {
  const [params, setParams] = useQueryStates({
    range: parseAsStringLiteral(PRESETS).withDefault(fallback),
    from: parseAsString,
    to: parseAsString
  });
  if (!today) return null;
  const custom = !!(params.from && params.to);
  const range: ReportRange =
    custom && params.from! <= params.to! && params.to! <= today
      ? { from: params.from!, to: params.to! }
      : presetRange(params.range, today);
  return {
    range,
    today,
    preset: custom ? ('custom' as const) : params.range,
    choose: (value: Preset | 'custom') =>
      value === 'custom'
        ? setParams({ from: range.from, to: range.to })
        : setParams({ range: value, from: null, to: null }),
    setDates: (from: string, to: string) => setParams({ from, to })
  };
}

export function RangePicker({ state }: { state: NonNullable<ReturnType<typeof useReportRange>> }) {
  const { range, today } = state;
  const days = daysIn(range);
  return (
    <div className='grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center print:hidden'>
      <NativeSelect
        aria-label='Period'
        className='col-span-2 w-full sm:w-fit'
        value={state.preset}
        onChange={(e) => void state.choose(e.target.value as Preset | 'custom')}
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
          if (from) void state.setDates(from, from > range.to ? from : range.to);
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
          if (to) void state.setDates(to < range.from ? to : range.from, to);
        }}
      />
      <span className='text-muted-foreground col-span-2 text-sm'>
        {days === 1 ? rangeLabel(range) : `${days} days`}
      </span>
    </div>
  );
}
