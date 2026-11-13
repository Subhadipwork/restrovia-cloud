'use client';

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import {
  type ChartConfig,
  EChartsBarChart
} from '@/components/evilcharts/charts/echarts-bar-chart';
import {
  tooltipIndicatorHtml,
  tooltipRow,
  tooltipShell
} from '@/components/evilcharts/ui/echarts-tooltip';

/** Widest a bar may grow, so a chart with one or two bars doesn't fill the card. */
const MAX_BAR_PX = 28;

/** Width of the element `ref` points at, kept current as it resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * The pixel gap between categories that caps each bar at MAX_BAR_PX: ECharts gives bars
 * whatever the gap leaves, and puts 30% of a bar's width between bars of one category.
 */
function categoryGap(width: number, categories: number, barsPerCategory: number) {
  if (!width || !categories) return undefined;
  const pitch = width / categories;
  const group = MAX_BAR_PX * (barsPerCategory + 0.3 * (barsPerCategory - 1));
  return Math.max(pitch - group, pitch * 0.2);
}

export type BarSeries = { key: string; label: string; color: string };

/**
 * The portal's bar chart, built on EvilCharts: one or more series side by side over a category
 * label, with the tooltip showing each series' value through `formatValue` (money, usually).
 */
export function SeriesBarChart<TRow extends { label: string } & Record<string, unknown>>({
  rows,
  series,
  formatValue,
  className = 'aspect-auto h-60 w-full',
  style
}: {
  rows: TRow[];
  series: BarSeries[];
  formatValue: (n: number) => string;
  className?: string;
  style?: CSSProperties;
}) {
  const { ref, width } = useWidth();
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, colors: { light: [s.color], dark: [s.color] } }])
  );

  const formatter = (params: unknown) => {
    const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number };
    const row = first?.dataIndex === undefined ? undefined : rows[first.dataIndex];
    if (!row) return '';
    const body = series
      .map((s) => {
        const value = row[s.key];
        if (typeof value !== 'number') return '';
        return tooltipRow({
          indicatorHtml: tooltipIndicatorHtml(s.key, 1),
          labelText: s.label,
          valueText: formatValue(value),
          dimmed: ''
        });
      })
      .join('');
    return tooltipShell({ label: row.label, body, roundness: 'md', variant: 'default' });
  };

  return (
    <div ref={ref} style={style}>
      <EChartsBarChart
        data={rows}
        config={config}
        xDataKey='label'
        className={className}
        barCategoryGap={categoryGap(width, rows.length, series.length)}
        chartOptions={{
          tooltip: {
            show: true,
            trigger: 'axis',
            confine: true,
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
            extraCssText: 'box-shadow:none;',
            axisPointer: { type: 'none' },
            formatter
          }
        }}
      >
        <EChartsBarChart.Grid />
        <EChartsBarChart.XAxis />
        {series.map((s) => (
          <EChartsBarChart.Bar key={s.key} dataKey={s.key} />
        ))}
        <EChartsBarChart.Tooltip />
      </EChartsBarChart>
    </div>
  );
}
