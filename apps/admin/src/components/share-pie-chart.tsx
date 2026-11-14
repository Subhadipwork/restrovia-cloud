'use client';

import {
  type ChartConfig,
  EChartsPieChart
} from '@/components/evilcharts/charts/echarts-pie-chart';
import {
  escapeTooltipHtml,
  tooltipIndicatorHtml,
  tooltipRow,
  tooltipShell
} from '@/components/evilcharts/ui/echarts-tooltip';

export type ShareRow = {
  key: string;
  label: string;
  value: number;
  /** Shown beside the label in the legend and tooltip, e.g. "14 bills · ₹1,250". */
  detail?: string;
};

const BASE = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

/** Theme chart colours, then lighter mixes of them, so a long breakdown keeps distinct hues. */
export function shareColor(i: number): string {
  const base = `var(${BASE[i % BASE.length]})`;
  const round = Math.floor(i / BASE.length);
  return round === 0
    ? base
    : `color-mix(in oklab, ${base} ${100 - round * 30}%, var(--background))`;
}

/**
 * A breakdown of one whole (order types, payment methods, reasons) as an EvilCharts donut, with a
 * legend listing each part's value and share.
 */
export function SharePieChart({
  rows,
  formatValue = (n) => n.toLocaleString('en-IN'),
  className = 'aspect-square h-44 w-44'
}: {
  rows: ShareRow[];
  formatValue?: (n: number) => string;
  className?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 1000) / 10}%` : '0%');
  const config: ChartConfig = Object.fromEntries(
    rows.map((r, i) => [
      r.key,
      { label: r.label, colors: { light: [shareColor(i)], dark: [shareColor(i)] } }
    ])
  );
  const data = rows.map((r) => ({ name: r.key, value: r.value }));

  const formatter = (params: unknown) => {
    const p = params as { dataIndex?: number };
    const row = p?.dataIndex === undefined ? undefined : rows[p.dataIndex];
    if (!row) return '';
    const body =
      tooltipRow({
        indicatorHtml: tooltipIndicatorHtml(row.key, 1),
        labelText: pct(row.value),
        valueText: formatValue(row.value),
        dimmed: ''
      }) +
      (row.detail
        ? `<div class="text-muted-foreground tabular-nums">${escapeTooltipHtml(row.detail)}</div>`
        : '');
    return tooltipShell({ label: row.label, body, roundness: 'md', variant: 'default' });
  };

  return (
    <div className='flex flex-col items-center gap-4 sm:flex-row sm:items-center'>
      <div className='shrink-0'>
        <EChartsPieChart
          data={data}
          config={config}
          dataKey='value'
          nameKey='name'
          className={className}
          chartOptions={{
            tooltip: {
              show: true,
              trigger: 'item',
              confine: true,
              backgroundColor: 'transparent',
              borderWidth: 0,
              padding: 0,
              extraCssText: 'box-shadow:none;',
              formatter
            }
          }}
        >
          <EChartsPieChart.Pie
            innerRadius='58%'
            outerRadius='92%'
            cornerRadius={4}
            paddingAngle={2}
          />
          <EChartsPieChart.Tooltip />
        </EChartsPieChart>
      </div>
      <ul className='flex w-full min-w-0 flex-col gap-2 text-sm'>
        {rows.map((r, i) => (
          <li key={r.key} className='flex items-start gap-2'>
            <span
              className='mt-1.5 size-2.5 shrink-0 rounded-sm'
              style={{ background: shareColor(i) }}
              aria-hidden
            />
            <span className='flex min-w-0 flex-1 flex-col'>
              <span className='flex justify-between gap-2'>
                <span className='truncate'>{r.label}</span>
                <span className='font-medium tabular-nums'>{formatValue(r.value)}</span>
              </span>
              <span className='text-muted-foreground flex justify-between gap-2 text-xs tabular-nums'>
                <span className='truncate'>{r.detail}</span>
                <span>{pct(r.value)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
