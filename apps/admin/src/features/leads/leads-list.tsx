'use client';

import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState } from 'react';
import { LEAD_SOURCES, LEAD_STAGES, LEAD_TEMPERATURES } from '@restrovia/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { EmptyRow, Pager, QueryState } from '@/features/admin/ui';
import { useCan } from '@/features/auth/use-admin';
import { formatDateTime, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { exportUrl, useAssignees, useLeads } from './api';
import { BulkBar } from './bulk-bar';
import { ImportDialog } from './import-dialog';
import { LeadFormDialog } from './lead-form';
import { SOURCE_LABELS, STAGE_LABELS, TEMPERATURE_DOT, TEMPERATURE_LABELS } from './labels';
import { StageBadge } from './stage-badge';

const PER_PAGE = 25;

/** Quick views; each sets a group of filters at once. */
const VIEWS = [
  { key: 'open', label: 'All open', filters: { stage: 'open' } },
  { key: 'mine', label: 'My leads', filters: { stage: 'open', assigned: 'me' } },
  { key: 'unassigned', label: 'Unassigned', filters: { stage: 'open', assigned: 'none' } },
  { key: 'overdue', label: 'Overdue', filters: { follow_up: 'overdue' } },
  { key: 'today', label: 'Due today', filters: { follow_up: 'today' } },
  { key: 'hot', label: 'Hot', filters: { stage: 'open', temperature: 'hot' } },
  { key: 'no_follow_up', label: 'No follow-up', filters: { follow_up: 'none' } }
] as const;

const EMPTY_FILTERS = { stage: '', assigned: '', source: '', temperature: '', follow_up: '' };

export function LeadsScreen() {
  const canEdit = useCan('leads.edit');
  const canExport = useCan('leads.export');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [now] = useState(() => Date.now());
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    q: parseAsString.withDefault(''),
    stage: parseAsString.withDefault('open'),
    assigned: parseAsString.withDefault(''),
    source: parseAsString.withDefault(''),
    temperature: parseAsString.withDefault(''),
    follow_up: parseAsString.withDefault('')
  });
  const [search, setSearch] = useState(params.q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== params.q) void setParams({ q: search, page: 1 });
    }, 300);
    return () => clearTimeout(t);
  }, [search, params.q, setParams]);

  const assignees = useAssignees();
  const filters = {
    q: params.q || undefined,
    stage: params.stage || undefined,
    assigned: params.assigned || undefined,
    source: params.source || undefined,
    temperature: params.temperature || undefined,
    follow_up: params.follow_up || undefined
  };
  const { data, isPending, error } = useLeads({
    ...filters,
    page: params.page,
    per_page: PER_PAGE
  });

  // A selection belongs to one page of one filter set; changing either clears it.
  const viewKey = JSON.stringify(params);
  const [picked, setPicked] = useState<{ key: string; ids: Set<string> }>({
    key: viewKey,
    ids: new Set()
  });
  const selected = picked.key === viewKey ? picked.ids : new Set<string>();
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked({ key: viewKey, ids: next });
  };
  const pageIds = data?.data.map((l) => l.id) ?? [];
  const allPicked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const activeView = VIEWS.find((v) =>
    Object.entries({ ...EMPTY_FILTERS, ...v.filters }).every(
      ([k, val]) => params[k as keyof typeof EMPTY_FILTERS] === val
    )
  )?.key;
  const filter = (k: keyof typeof EMPTY_FILTERS) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    void setParams({ [k]: e.target.value, page: 1 });

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {VIEWS.map((v) => (
          <Button
            key={v.key}
            size='sm'
            variant={activeView === v.key ? 'default' : 'outline'}
            onClick={() => void setParams({ ...EMPTY_FILTERS, ...v.filters, page: 1 })}
          >
            {v.label}
          </Button>
        ))}
        <div className='ml-auto flex gap-2'>
          {canExport && (
            <a
              href={exportUrl(filters)}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              download
            >
              Export CSV
            </a>
          )}
          {canEdit && (
            <Button size='sm' variant='outline' onClick={() => setImporting(true)}>
              Import CSV
            </Button>
          )}
          {canEdit && (
            <Button size='sm' onClick={() => setAdding(true)}>
              Add lead
            </Button>
          )}
        </div>
      </div>

      <div className='flex flex-wrap gap-2'>
        <Input
          aria-label='Search leads'
          placeholder='Search name, contact, phone, email, city'
          className='w-full sm:w-72'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect aria-label='Stage' value={params.stage} onChange={filter('stage')}>
          <NativeSelectOption value=''>All stages</NativeSelectOption>
          <NativeSelectOption value='open'>All open stages</NativeSelectOption>
          {LEAD_STAGES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {STAGE_LABELS[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label='Owner' value={params.assigned} onChange={filter('assigned')}>
          <NativeSelectOption value=''>Any owner</NativeSelectOption>
          <NativeSelectOption value='me'>Me</NativeSelectOption>
          <NativeSelectOption value='none'>Unassigned</NativeSelectOption>
          {assignees.data?.map((a) => (
            <NativeSelectOption key={a.id} value={a.id}>
              {a.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label='Source' value={params.source} onChange={filter('source')}>
          <NativeSelectOption value=''>Any source</NativeSelectOption>
          {LEAD_SOURCES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {SOURCE_LABELS[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label='Temperature'
          value={params.temperature}
          onChange={filter('temperature')}
        >
          <NativeSelectOption value=''>Any temperature</NativeSelectOption>
          {LEAD_TEMPERATURES.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {TEMPERATURE_LABELS[t]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label='Follow-up'
          value={params.follow_up}
          onChange={filter('follow_up')}
        >
          <NativeSelectOption value=''>Any follow-up</NativeSelectOption>
          <NativeSelectOption value='overdue'>Overdue</NativeSelectOption>
          <NativeSelectOption value='today'>Due today</NativeSelectOption>
          <NativeSelectOption value='week'>Due this week</NativeSelectOption>
          <NativeSelectOption value='none'>None planned</NativeSelectOption>
        </NativeSelect>
      </div>

      {canEdit && selected.size > 0 && (
        <BulkBar ids={[...selected]} onDone={() => setPicked({ key: viewKey, ids: new Set() })} />
      )}

      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className='w-8'>
                      <Checkbox
                        aria-label='Select all leads on this page'
                        checked={allPicked}
                        onCheckedChange={(v) => toggle(pageIds, v === true)}
                      />
                    </TableHead>
                  )}
                  <TableHead>Business</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Next follow-up</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.length === 0 && (
                  <EmptyRow colSpan={canEdit ? 8 : 7}>No leads match these filters.</EmptyRow>
                )}
                {data.data.map((l) => {
                  const overdue =
                    l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now;
                  return (
                    <TableRow key={l.id} data-state={selected.has(l.id) ? 'selected' : undefined}>
                      {canEdit && (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${l.business_name}`}
                            checked={selected.has(l.id)}
                            onCheckedChange={(v) => toggle([l.id], v === true)}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <span
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              TEMPERATURE_DOT[l.temperature]
                            )}
                            title={TEMPERATURE_LABELS[l.temperature]}
                            aria-label={TEMPERATURE_LABELS[l.temperature]}
                          />
                          <Link
                            href={`/dashboard/leads/${l.id}`}
                            className='font-medium hover:underline'
                          >
                            {l.business_name}
                          </Link>
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          {[l.area, l.city].filter(Boolean).join(', ') || '—'}
                        </div>
                      </TableCell>
                      <TableCell className='text-sm'>
                        <div>{l.contact_name || '—'}</div>
                        {l.phone && (
                          <a href={`tel:${l.phone}`} className='text-muted-foreground text-xs'>
                            {l.phone}
                          </a>
                        )}
                      </TableCell>
                      <TableCell>
                        <StageBadge stage={l.stage} />
                      </TableCell>
                      <TableCell className='text-sm'>
                        {l.assigned_admin_name ?? (
                          <span className='text-muted-foreground'>Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn('text-sm', overdue && 'text-destructive font-medium')}
                      >
                        {l.next_follow_up_at ? formatDateTime(l.next_follow_up_at) : '—'}
                      </TableCell>
                      <TableCell className='text-sm'>{timeAgo(l.last_activity_at)}</TableCell>
                      <TableCell className='text-sm'>{SOURCE_LABELS[l.source]}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={data.page}
            perPage={data.per_page}
            total={data.total}
            onPage={(page) => void setParams({ page })}
          />
        </>
      )}
      {canEdit && <LeadFormDialog open={adding} onClose={() => setAdding(false)} />}
      {canEdit && <ImportDialog open={importing} onClose={() => setImporting(false)} />}
    </div>
  );
}
