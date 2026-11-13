'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type ChartConfig,
  EChartsBarChart
} from '@/components/evilcharts/charts/echarts-bar-chart';
import {
  escapeTooltipHtml,
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

export type ValueBarRow = {
  label: string;
  value: number | null;
  /** Shown in the tooltip instead of the bare value, e.g. "₹1,250 · 14 bills". */
  detail?: string;
};

/**
 * One measure per chart, one hue: the panel's standard bar chart, built on EvilCharts. The
 * tooltip keeps EvilCharts' styling but shows the row's formatted value or detail line.
 */
export function ValueBarChart({
  rows,
  seriesLabel,
  color = 'var(--chart-2)',
  formatValue = (n) => n.toLocaleString('en-IN'),
  className = 'aspect-auto h-48 w-full',
  layout = 'vertical'
}: {
  rows: ValueBarRow[];
  seriesLabel: string;
  color?: string;
  formatValue?: (n: number) => string;
  className?: string;
  /** `horizontal` lists the rows top to bottom (a funnel, a ranking), with labels on the left. */
  layout?: 'vertical' | 'horizontal';
}) {
  const horizontal = layout === 'horizontal';
  const { ref, width } = useWidth();
  const config = {
    value: { label: seriesLabel, colors: { light: [color], dark: [color] } }
  } satisfies ChartConfig;

  const formatter = (params: unknown) => {
    const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number };
    const row = first?.dataIndex === undefined ? undefined : rows[first.dataIndex];
    if (!row) return '';
    const body =
      row.detail !== undefined
        ? `<div class="text-muted-foreground tabular-nums">${escapeTooltipHtml(row.detail)}</div>`
        : row.value === null
          ? ''
          : tooltipRow({
              indicatorHtml: tooltipIndicatorHtml('value', 1),
              labelText: seriesLabel,
              valueText: formatValue(row.value),
              dimmed: ''
            });
    return tooltipShell({ label: row.label, body, roundness: 'md', variant: 'default' });
  };

  return (
    <div ref={ref}>
      <EChartsBarChart
        data={rows}
        config={config}
        xDataKey='label'
        className={className}
        layout={horizontal ? 'horizontal' : 'vertical'}
        barCategoryGap={horizontal ? undefined : categoryGap(width, rows.length, 1)}
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
        {horizontal ? <EChartsBarChart.YAxis /> : <EChartsBarChart.XAxis />}
        <EChartsBarChart.Bar dataKey='value' />
        <EChartsBarChart.Tooltip />
      </EChartsBarChart>
    </div>
  );
}
