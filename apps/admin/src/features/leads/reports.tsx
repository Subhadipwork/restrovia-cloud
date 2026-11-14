'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import type { LeadLostReason } from '@restrovia/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SharePieChart } from '@/components/share-pie-chart';
import { type ValueBarRow, ValueBarChart } from '@/components/value-bar-chart';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { EmptyRow, QueryState, StatCard } from '@/features/admin/ui';
import { formatMoney } from '@/lib/display';
import { DATE_PRESETS, istDay, shortDay } from '@/lib/ist-dates';
import { type LeadReport, useLeadReport } from './api';
import { LOST_REASON_LABELS, SOURCE_LABELS, STAGE_LABELS } from './labels';

const PRESETS = [
  ...DATE_PRESETS.slice(0, 3),
  { label: 'Last 90 days', range: (): [string, string] => [istDay(-89), istDay()] }
];

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—';

function WeeklyCard({ weekly }: { weekly: LeadReport['weekly'] }) {
  const byWeek = new Map<string, { total: number; sources: Map<string, number> }>();
  for (const w of weekly) {
    const entry = byWeek.get(w.week) ?? { total: 0, sources: new Map() };
    entry.total += w.n;
    entry.sources.set(w.source, (entry.sources.get(w.source) ?? 0) + w.n);
    byWeek.set(w.week, entry);
  }
  const rows: ValueBarRow[] = [...byWeek.entries()].map(([week, e]) => {
    const top = [...e.sources.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, n]) => `${SOURCE_LABELS[s as keyof typeof SOURCE_LABELS] ?? s} ${n}`)
      .join(' · ');
    return {
      label: shortDay(week),
      value: e.total,
      detail: `${e.total} new ${e.total === 1 ? 'lead' : 'leads'}${top ? ` · ${top}` : ''}`
    };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>New leads per week</CardTitle>
        <CardDescription>Weeks start on Monday. Hover a bar for the top sources.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No leads were added in this range.</p>
        ) : (
          <ValueBarChart rows={rows} seriesLabel='New leads' />
        )}
      </CardContent>
    </Card>
  );
}

function ReportView({ data }: { data: LeadReport }) {
  const created = data.totals.created;
  const lostTotal = data.lost_reasons.reduce((s, r) => s + r.n, 0);
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard label='Leads added' value={created} />
        <StatCard
          label='Won'
          value={data.totals.won}
          hint='Marked won in this range, whenever they were added'
        />
        <StatCard
          label='Won value'
          value={formatMoney(data.totals.won_value)}
          hint='Expected monthly value of those wins'
        />
        <StatCard
          label='Median days to win'
          value={data.totals.median_days_to_win ?? '—'}
          hint='From added to won'
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Funnel</CardTitle>
            <CardDescription>
              Of the leads added in this range, how many reached each stage (lost leads count for
              every stage they got to).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {created === 0 ? (
              <p className='text-muted-foreground text-sm'>No leads were added in this range.</p>
            ) : (
              <ValueBarChart
                layout='horizontal'
                className='aspect-auto h-72 w-full'
                seriesLabel='Leads'
                rows={data.funnel.map((f) => ({
                  label: STAGE_LABELS[f.stage],
                  value: f.count,
                  detail: `${f.count} ${f.count === 1 ? 'lead' : 'leads'} · ${pct(f.count, created)} of those added`
                }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Why leads were lost</CardTitle>
            <CardDescription>Leads marked lost in this range.</CardDescription>
          </CardHeader>
          <CardContent>
            {lostTotal === 0 ? (
              <p className='text-muted-foreground text-sm'>No leads were lost in this range.</p>
            ) : (
              <SharePieChart
                rows={data.lost_reasons.map((r) => ({
                  key: r.reason ?? 'none',
                  label: r.reason ? LOST_REASON_LABELS[r.reason as LeadLostReason] : 'No reason',
                  value: r.n
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <WeeklyCard weekly={data.weekly} />

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>By source</CardTitle>
          <CardDescription>
            Leads added in this range and where they stand now. Conversion is won ÷ added.
          </CardDescription>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className='text-right'>Added</TableHead>
                <TableHead className='text-right'>Won</TableHead>
                <TableHead className='text-right'>Lost</TableHead>
                <TableHead className='text-right'>Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.by_source.length === 0 && <EmptyRow colSpan={5}>No leads added.</EmptyRow>}
              {data.by_source.map((s) => (
                <TableRow key={s.source}>
                  <TableCell>{SOURCE_LABELS[s.source] ?? s.source}</TableCell>
                  <TableCell className='text-right tabular-nums'>{s.total}</TableCell>
                  <TableCell className='text-right tabular-nums'>{s.won}</TableCell>
                  <TableCell className='text-right tabular-nums'>{s.lost}</TableCell>
                  <TableCell className='text-right tabular-nums'>{pct(s.won, s.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>By team member</CardTitle>
          <CardDescription>
            Open leads and overdue follow-ups are as of now; the rest are for this range.
          </CardDescription>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className='text-right'>Open leads</TableHead>
                <TableHead className='text-right'>Activities logged</TableHead>
                <TableHead className='text-right'>Demos</TableHead>
                <TableHead className='text-right'>Won</TableHead>
                <TableHead className='text-right'>Overdue follow-ups</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.by_admin.length === 0 && (
                <EmptyRow colSpan={6}>No active sales admins.</EmptyRow>
              )}
              {data.by_admin.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell className='text-right tabular-nums'>{a.open}</TableCell>
                  <TableCell className='text-right tabular-nums'>{a.activities}</TableCell>
                  <TableCell className='text-right tabular-nums'>{a.demos}</TableCell>
                  <TableCell className='text-right tabular-nums'>{a.won}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${a.overdue_tasks ? 'text-destructive font-medium' : ''}`}
                  >
                    {a.overdue_tasks}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsScreen() {
  const [range, setRange] = useQueryStates({
    from: parseAsString.withDefault(istDay(-29)),
    to: parseAsString.withDefault(istDay())
  });
  const valid = range.from <= range.to;
  const { data, isPending, error } = useLeadReport(range.from, range.to);

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-end gap-2'>
        {PRESETS.map((p) => {
          const [from, to] = p.range();
          return (
            <Button
              key={p.label}
              size='sm'
              variant={range.from === from && range.to === to ? 'default' : 'outline'}
              onClick={() => void setRange({ from, to })}
            >
              {p.label}
            </Button>
          );
        })}
        <div className='flex flex-col gap-1'>
          <Label htmlFor='from' className='text-muted-foreground text-xs'>
            From
          </Label>
          <Input
            id='from'
            type='date'
            className='h-7 w-auto'
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && void setRange({ from: e.target.value })}
          />
        </div>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='to' className='text-muted-foreground text-xs'>
            To
          </Label>
          <Input
            id='to'
            type='date'
            className='h-7 w-auto'
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && void setRange({ to: e.target.value })}
          />
        </div>
      </div>
      {!valid ? (
        <p className='text-destructive text-sm'>The start date must be on or before the end.</p>
      ) : !data ? (
        <QueryState isPending={isPending} error={error} rows={6} />
      ) : (
        <ReportView data={data} />
      )}
    </div>
  );
}
