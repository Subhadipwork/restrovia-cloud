'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  LEAD_CALL_OUTCOMES,
  LEAD_MANUAL_ACTIVITY_TYPES,
  LEAD_STAGES,
  LEAD_TASK_TYPES,
  type LeadCallOutcome,
  type LeadLostReason,
  type LeadManualActivityType,
  type LeadStage,
  type LeadTaskType
} from '@restrovia/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useStores } from '@/features/admin/api';
import { Pager, QueryState } from '@/features/admin/ui';
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import {
  formatDateTime,
  formatDay,
  formatMoney,
  LICENCE_LABELS,
  licenceTone,
  timeAgo
} from '@/lib/display';
import { cn } from '@/lib/utils';
import {
  type LeadDetail,
  type LeadTask,
  useAddActivity,
  useAddTask,
  useAssignees,
  useAssignLead,
  useChangeStage,
  useDeleteLead,
  useDeleteTask,
  useLead,
  useLeadActivities,
  useLinkStore,
  useMergeLead,
  useUpdateTask
} from './api';
import { LeadFormDialog } from './lead-form';
import { LeadLocationCard, LeadPhotosCard } from './lead-media';
import { LostDialog } from './lost-dialog';
import { StageBadge } from './stage-badge';
import {
  ACTIVITY_TYPE_LABELS,
  BUSINESS_TYPE_LABELS,
  LOST_REASON_LABELS,
  OUTCOME_LABELS,
  SOURCE_LABELS,
  STAGE_COLOURS,
  STAGE_LABELS,
  TASK_TYPE_LABELS,
  TEMPERATURE_DOT,
  TEMPERATURE_LABELS,
  waNumber
} from './labels';

const PIPELINE: readonly LeadStage[] = LEAD_STAGES.filter((s) => s !== 'lost');
const isStage = (v: unknown): v is LeadStage => LEAD_STAGES.includes(v as LeadStage);
const linkButton = buttonVariants({ size: 'sm', variant: 'outline' });

/** A datetime-local value (local time, minutes) for now plus some hours. */
function localInput(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const toIso = (local: string) => new Date(local).toISOString();
const onError = (err: unknown) => toast.error(errorMessage(err));

function StageStepper({
  stage,
  disabled,
  onPick
}: {
  stage: LeadStage;
  disabled: boolean;
  onPick: (s: LeadStage) => void;
}) {
  const current = PIPELINE.indexOf(stage);
  return (
    <ol className='flex flex-wrap gap-1' aria-label='Pipeline stage'>
      {PIPELINE.map((s, i) => {
        const isCurrent = s === stage;
        const passed = stage !== 'lost' && i < current;
        return (
          <li key={s}>
            <button
              type='button'
              disabled={disabled || isCurrent}
              onClick={() => onPick(s)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isCurrent && STAGE_COLOURS[s].solid,
                passed && STAGE_COLOURS[s].soft,
                !isCurrent && !passed && 'text-muted-foreground hover:bg-muted',
                disabled && !isCurrent && 'cursor-default'
              )}
            >
              {!isCurrent && (
                <span className={cn('size-1.5 rounded-full', STAGE_COLOURS[s].dot)} aria-hidden />
              )}
              {STAGE_LABELS[s]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function LinkStoreDialog({
  leadId,
  open,
  onClose
}: {
  leadId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const stores = useStores({ search: search.trim() || undefined, page: 1, per_page: 8 });
  const link = useLinkStore(leadId);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a customer store</DialogTitle>
          <DialogDescription>
            Pick the store this café registered when it installed Restrovia POS.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          aria-label='Search stores'
          placeholder='Store name, phone, email or store code'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className='flex max-h-72 flex-col gap-1 overflow-y-auto'>
          {stores.data?.data.map((s) => (
            <li key={s.id}>
              <button
                type='button'
                disabled={link.isPending}
                className='hover:bg-muted flex w-full items-center justify-between rounded-md p-2 text-left text-sm'
                onClick={() =>
                  link.mutate(s.id, {
                    onSuccess: () => {
                      toast.success(`Linked to ${s.name || 'the store'}`);
                      onClose();
                    },
                    onError: (err) => toast.error(errorMessage(err))
                  })
                }
              >
                <span>
                  <span className='font-medium'>{s.name || 'Unnamed store'}</span>
                  <span className='text-muted-foreground block text-xs'>
                    {[s.phone, s.email].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <Badge variant={licenceTone(s.licence_status)}>
                  {LICENCE_LABELS[s.licence_status ?? 'none']}
                </Badge>
              </button>
            </li>
          ))}
          {stores.data?.data.length === 0 && (
            <li className='text-muted-foreground p-2 text-sm'>No stores match.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({ task, leadId, canEdit }: { task: LeadTask; leadId: string; canEdit: boolean }) {
  const update = useUpdateTask(leadId);
  const remove = useDeleteTask(leadId);
  const [logging, setLogging] = useState(false);
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState<LeadCallOutcome>('connected');
  const [now] = useState(() => Date.now());
  const overdue = new Date(task.due_at).getTime() < now;
  const snooze = (hours: number) =>
    update.mutate(
      { taskId: task.id, due_at: new Date(Date.now() + hours * 3_600_000).toISOString() },
      { onError }
    );

  return (
    <li className='rounded-lg border p-3 text-sm'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='font-medium'>
            {TASK_TYPE_LABELS[task.type]}: {task.title}
          </div>
          <div className={cn('text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
            {overdue ? 'Overdue · ' : ''}
            {formatDateTime(task.due_at)}
            {task.assigned_admin_name && ` · ${task.assigned_admin_name}`}
          </div>
        </div>
        {canEdit && (
          <div className='flex flex-wrap gap-1'>
            <Button
              size='sm'
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { taskId: task.id, done: true },
                  { onSuccess: () => toast.success('Follow-up done'), onError }
                )
              }
            >
              Done
            </Button>
            <Button size='sm' variant='outline' onClick={() => setLogging((v) => !v)}>
              Done + log
            </Button>
            <NativeSelect
              aria-label='Snooze'
              size='sm'
              value=''
              onChange={(e) => e.target.value && snooze(Number(e.target.value))}
            >
              <NativeSelectOption value=''>Snooze…</NativeSelectOption>
              <NativeSelectOption value='1'>1 hour</NativeSelectOption>
              <NativeSelectOption value='24'>1 day</NativeSelectOption>
              <NativeSelectOption value='72'>3 days</NativeSelectOption>
              <NativeSelectOption value='168'>1 week</NativeSelectOption>
            </NativeSelect>
            <Button
              size='sm'
              variant='ghost'
              aria-label='Delete follow-up'
              disabled={remove.isPending}
              onClick={() => remove.mutate(task.id, { onError })}
            >
              ✕
            </Button>
          </div>
        )}
      </div>
      {logging && (
        <form
          className='mt-3 flex flex-col gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              {
                taskId: task.id,
                done: true,
                log: { body: body.trim(), ...(task.type === 'call' ? { outcome } : {}) }
              },
              {
                onSuccess: () => {
                  toast.success('Follow-up done and logged');
                  setLogging(false);
                },
                onError
              }
            );
          }}
        >
          {task.type === 'call' && (
            <NativeSelect
              aria-label='Call outcome'
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as LeadCallOutcome)}
            >
              {LEAD_CALL_OUTCOMES.map((o) => (
                <NativeSelectOption key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <Textarea
            aria-label='What happened'
            placeholder='What happened'
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type='submit' size='sm' className='self-start' disabled={update.isPending}>
            Save
          </Button>
        </form>
      )}
    </li>
  );
}

function FollowUps({ data, canEdit }: { data: LeadDetail; canEdit: boolean }) {
  const add = useAddTask(data.lead.id);
  const [form, setForm] = useState({
    type: 'call' as LeadTaskType,
    title: '',
    due: localInput(24)
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Follow-ups</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {data.open_tasks.length === 0 && (
          <p className='text-muted-foreground text-sm'>No follow-up planned.</p>
        )}
        <ul className='flex flex-col gap-2'>
          {data.open_tasks.map((t) => (
            <TaskRow key={t.id} task={t} leadId={data.lead.id} canEdit={canEdit} />
          ))}
        </ul>
        {canEdit && (
          <form
            className='flex flex-wrap items-end gap-2'
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(
                {
                  type: form.type,
                  title: form.title.trim() || TASK_TYPE_LABELS[form.type],
                  due_at: toIso(form.due)
                },
                {
                  onSuccess: () => {
                    toast.success('Follow-up added');
                    setForm({ type: 'call', title: '', due: localInput(24) });
                  },
                  onError: (err) => toast.error(errorMessage(err))
                }
              );
            }}
          >
            <NativeSelect
              aria-label='Follow-up type'
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LeadTaskType }))}
            >
              {LEAD_TASK_TYPES.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label='Follow-up title'
              placeholder='What to do'
              className='min-w-40 flex-1'
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <Input
              aria-label='Due'
              type='datetime-local'
              className='w-auto'
              required
              value={form.due}
              onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
            />
            <Button type='submit' size='sm' disabled={add.isPending}>
              Add follow-up
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function describeActivity(a: { type: string; meta: Record<string, unknown> }): string {
  const m = a.meta;
  if (a.type === 'stage_change') {
    return m.lost_reason ? `Reason: ${LOST_REASON_LABELS[m.lost_reason as LeadLostReason]}` : '';
  }
  if (a.type === 'merged') return `Merged in: ${String(m.duplicate_name ?? '')}`;
  if (a.type === 'assignment') return m.to_name ? `Owner: ${m.to_name}` : 'Owner removed';
  if (a.type === 'created') {
    return `Source: ${SOURCE_LABELS[m.source as keyof typeof SOURCE_LABELS] ?? m.source}`;
  }
  if (a.type === 'task_done' || m.task_title) return `Follow-up: ${String(m.task_title ?? '')}`;
  return '';
}

function Timeline({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useLeadActivities(leadId, page);
  const add = useAddActivity(leadId);
  const [type, setType] = useState<LeadManualActivityType>('note');
  const [outcome, setOutcome] = useState<LeadCallOutcome>('connected');
  const [duration, setDuration] = useState('');
  const [body, setBody] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Timeline</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {canEdit && (
          <form
            className='flex flex-col gap-2'
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(
                {
                  type,
                  body: body.trim(),
                  ...(type === 'call'
                    ? { outcome, ...(duration ? { duration_min: Number(duration) } : {}) }
                    : {})
                },
                {
                  onSuccess: () => {
                    setBody('');
                    setDuration('');
                    setPage(1);
                  },
                  onError: (err) => toast.error(errorMessage(err))
                }
              );
            }}
          >
            <div className='flex flex-wrap gap-2'>
              <NativeSelect
                aria-label='Activity type'
                value={type}
                onChange={(e) => setType(e.target.value as LeadManualActivityType)}
              >
                {LEAD_MANUAL_ACTIVITY_TYPES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {ACTIVITY_TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {type === 'call' && (
                <>
                  <NativeSelect
                    aria-label='Call outcome'
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value as LeadCallOutcome)}
                  >
                    {LEAD_CALL_OUTCOMES.map((o) => (
                      <NativeSelectOption key={o} value={o}>
                        {OUTCOME_LABELS[o]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label='Minutes'
                    placeholder='Minutes'
                    type='number'
                    min={0}
                    max={600}
                    className='w-28'
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </>
              )}
            </div>
            <Textarea
              aria-label='Details'
              placeholder={type === 'note' ? 'Write a note' : 'What was said or agreed'}
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <Button
              type='submit'
              size='sm'
              className='self-start'
              disabled={add.isPending || (type === 'note' && !body.trim())}
            >
              {add.isPending ? 'Saving…' : `Log ${ACTIVITY_TYPE_LABELS[type].toLowerCase()}`}
            </Button>
          </form>
        )}
        {!data ? (
          <QueryState isPending={isPending} error={error} rows={3} />
        ) : (
          <>
            <ol className='flex flex-col gap-3'>
              {data.data.map((a) => {
                const summary = describeActivity(a);
                return (
                  <li
                    key={a.id}
                    className={cn(
                      'border-l-2 pl-3 text-sm',
                      a.type === 'stage_change' && isStage(a.meta.to)
                        ? STAGE_COLOURS[a.meta.to].line
                        : ''
                    )}
                  >
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>{ACTIVITY_TYPE_LABELS[a.type] ?? a.type}</span>
                      {a.outcome && <Badge variant='outline'>{OUTCOME_LABELS[a.outcome]}</Badge>}
                      {typeof a.meta.duration_min === 'number' && (
                        <span className='text-muted-foreground text-xs'>
                          {a.meta.duration_min} min
                        </span>
                      )}
                      <span className='text-muted-foreground text-xs'>
                        {a.admin_name ?? 'System'} · {formatDateTime(a.occurred_at)}
                      </span>
                    </div>
                    {a.type === 'stage_change' && isStage(a.meta.from) && isStage(a.meta.to) && (
                      <div className='mt-1 flex items-center gap-1.5'>
                        <StageBadge stage={a.meta.from} />
                        <span aria-label='to'>→</span>
                        <StageBadge stage={a.meta.to} />
                      </div>
                    )}
                    {summary && <div className='text-muted-foreground'>{summary}</div>}
                    {a.body && <p className='mt-1 whitespace-pre-wrap'>{a.body}</p>}
                  </li>
                );
              })}
            </ol>
            {data.total > data.per_page && (
              <Pager page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='break-words'>{children || '—'}</dd>
    </div>
  );
}

export function LeadDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const canEdit = useCan('leads.edit');
  const canDelete = useCan('leads.delete');
  const { data, isPending, error } = useLead(id);
  const assignees = useAssignees();
  const stage = useChangeStage(id);
  const assign = useAssignLead(id);
  const link = useLinkStore(id);
  const remove = useDeleteLead(id);
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [merging, setMerging] = useState<LeadDetail['duplicates']['leads'][number] | null>(null);
  const merge = useMergeLead(id);

  if (!data) return <QueryState isPending={isPending} error={error} rows={6} />;
  const { lead } = data;
  const moveTo = (s: LeadStage) =>
    stage.mutate(
      { stage: s },
      { onSuccess: () => toast.success(`Moved to ${STAGE_LABELS[s]}`), onError }
    );

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardContent className='flex flex-col gap-4 pt-6'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <div className='flex items-center gap-2'>
                <span
                  className={cn('size-2.5 rounded-full', TEMPERATURE_DOT[lead.temperature])}
                  aria-hidden
                />
                <h2 className='text-xl font-semibold'>{lead.businessName}</h2>
                <StageBadge stage={lead.stage} />
              </div>
              <p className='text-muted-foreground text-sm'>
                {[lead.contactName, lead.area, lead.city].filter(Boolean).join(' · ') ||
                  'No contact details yet'}
              </p>
              {lead.stage === 'lost' && lead.lostReason && (
                <p className='text-destructive text-sm'>
                  Lost: {LOST_REASON_LABELS[lead.lostReason]} · {formatDay(lead.lostAt)}
                </p>
              )}
            </div>
            <div className='flex flex-col gap-1'>
              <Label htmlFor='owner' className='text-muted-foreground text-xs'>
                Owner
              </Label>
              <NativeSelect
                id='owner'
                disabled={!canEdit || assign.isPending}
                value={lead.assignedAdminId ?? ''}
                onChange={(e) =>
                  assign.mutate(e.target.value || null, {
                    onSuccess: () => toast.success('Owner changed'),
                    onError
                  })
                }
              >
                <NativeSelectOption value=''>Unassigned</NativeSelectOption>
                {assignees.data?.map((a) => (
                  <NativeSelectOption key={a.id} value={a.id}>
                    {a.name}
                  </NativeSelectOption>
                ))}
                {lead.assignedAdminId &&
                  !assignees.data?.some((a) => a.id === lead.assignedAdminId) && (
                    <NativeSelectOption value={lead.assignedAdminId}>
                      {data.assigned_admin_name ?? 'Former admin'}
                    </NativeSelectOption>
                  )}
              </NativeSelect>
            </div>
          </div>

          <StageStepper stage={lead.stage} disabled={!canEdit || stage.isPending} onPick={moveTo} />

          <div className='flex flex-wrap gap-2'>
            {lead.phoneE164 && (
              <>
                <a href={`tel:${lead.phoneE164}`} className={linkButton}>
                  Call {lead.phoneE164}
                </a>
                <a
                  href={`https://wa.me/${waNumber(lead.phoneE164)}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={linkButton}
                >
                  WhatsApp
                </a>
              </>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className={linkButton}>
                Email
              </a>
            )}
            {canEdit && (
              <>
                <Button size='sm' variant='outline' onClick={() => setEditing(true)}>
                  Edit details
                </Button>
                {lead.stage !== 'lost' ? (
                  <Button size='sm' variant='outline' onClick={() => setLosing(true)}>
                    Mark lost
                  </Button>
                ) : (
                  <Button size='sm' variant='outline' onClick={() => moveTo('contacted')}>
                    Reopen
                  </Button>
                )}
              </>
            )}
            {canDelete && (
              <Button
                size='sm'
                variant='ghost'
                className='text-destructive ml-auto'
                onClick={() => setConfirmDelete(true)}
              >
                Delete lead
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-3'>
        <div className='flex flex-col gap-4 lg:col-span-2'>
          <FollowUps data={data} canEdit={canEdit} />
          <Timeline leadId={id} canEdit={canEdit} />
        </div>

        <div className='flex flex-col gap-4'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className='grid grid-cols-2 gap-3 text-sm'>
                <Detail label='Contact'>{lead.contactName}</Detail>
                <Detail label='Phone'>{lead.phoneE164}</Detail>
                <Detail label='Other phone'>{lead.altPhoneE164}</Detail>
                <Detail label='Email'>{lead.email}</Detail>
                <Detail label='City'>{lead.city}</Detail>
                <Detail label='Area'>{lead.area}</Detail>
                <div className='col-span-2'>
                  <Detail label='Address'>{lead.address}</Detail>
                </div>
                <Detail label='Type'>
                  {lead.businessType && BUSINESS_TYPE_LABELS[lead.businessType]}
                </Detail>
                <Detail label='Outlets'>{lead.outletCount}</Detail>
                <Detail label='Billing today'>{lead.currentPos}</Detail>
                <Detail label='Temperature'>{TEMPERATURE_LABELS[lead.temperature]}</Detail>
                <Detail label='Source'>
                  {SOURCE_LABELS[lead.source]}
                  {lead.sourceDetail && ` · ${lead.sourceDetail}`}
                </Detail>
                <Detail label='Plan interest'>{data.plan_name}</Detail>
                <Detail label='Value per month'>
                  {lead.expectedValue && formatMoney(lead.expectedValue)}
                </Detail>
                <Detail label='Close by'>
                  {lead.expectedCloseOn && formatDay(lead.expectedCloseOn)}
                </Detail>
                <div className='col-span-2'>
                  <Detail label='Tags'>
                    {lead.tags.length > 0 && (
                      <span className='flex flex-wrap gap-1'>
                        {lead.tags.map((t) => (
                          <Badge key={t} variant='outline'>
                            {t}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </Detail>
                </div>
                <Detail label='Added'>
                  {formatDay(lead.createdAt)}
                  {data.created_by_name && ` by ${data.created_by_name}`}
                </Detail>
                <Detail label='Last activity'>{timeAgo(lead.lastActivityAt)}</Detail>
              </dl>
            </CardContent>
          </Card>

          <LeadLocationCard lead={lead} />
          <LeadPhotosCard leadId={lead.id} photos={data.photos} />

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Customer store</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-2 text-sm'>
              {data.store ? (
                <>
                  <Link
                    href={`/dashboard/stores/${data.store.id}`}
                    className='font-medium hover:underline'
                  >
                    {data.store.name || 'Unnamed store'}
                  </Link>
                  <div className='flex items-center gap-2'>
                    <Badge variant={licenceTone(data.store.licence_status)}>
                      {LICENCE_LABELS[data.store.licence_status ?? 'none']}
                    </Badge>
                    {data.store.phone && (
                      <span className='text-muted-foreground'>{data.store.phone}</span>
                    )}
                  </div>
                  {canDelete && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='self-start'
                      disabled={link.isPending}
                      onClick={() =>
                        link.mutate(null, {
                          onSuccess: () => toast.success('Store unlinked'),
                          onError
                        })
                      }
                    >
                      Unlink
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className='text-muted-foreground'>
                    Not linked yet. Link the store once the café installs Restrovia POS; a lead can
                    only be marked won with a linked store.
                  </p>
                  {canEdit && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='self-start'
                      onClick={() => setLinking(true)}
                    >
                      Link store
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {(data.duplicates.leads.length > 0 || data.duplicates.stores.length > 0) && (
            <Card className='border-amber-500/50'>
              <CardHeader>
                <CardTitle className='text-base'>Possible duplicates</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className='flex flex-col gap-1 text-sm'>
                  {data.duplicates.leads.map((l) => (
                    <li key={l.id} className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                      <Link href={`/dashboard/leads/${l.id}`} className='hover:underline'>
                        {l.business_name}
                      </Link>
                      <StageBadge stage={l.stage} />
                      {canEdit && (
                        <Button
                          size='xs'
                          variant='outline'
                          className='ml-auto'
                          onClick={() => setMerging(l)}
                        >
                          Merge into this lead
                        </Button>
                      )}
                    </li>
                  ))}
                  {data.duplicates.stores.map((s) => (
                    <li key={s.id}>
                      <Link href={`/dashboard/stores/${s.id}`} className='hover:underline'>
                        {s.name || 'Unnamed store'}
                      </Link>
                      <span className='text-muted-foreground'> · customer store</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {canEdit && (
        <>
          <LeadFormDialog
            key={`${lead.updatedAt}-${data.photos.map((p) => p.id).join()}`}
            open={editing}
            onClose={() => setEditing(false)}
            lead={lead}
            photos={data.photos}
          />
          <LostDialog
            open={losing}
            onClose={() => setLosing(false)}
            pending={stage.isPending}
            onConfirm={(reason, note) =>
              stage.mutate(
                { stage: 'lost', lost_reason: reason, ...(note ? { note } : {}) },
                {
                  onSuccess: () => {
                    toast.success('Marked as lost');
                    setLosing(false);
                  },
                  onError
                }
              )
            }
          />
          <LinkStoreDialog leadId={id} open={linking} onClose={() => setLinking(false)} />
        </>
      )}
      {canEdit && (
        <Dialog open={!!merging} onOpenChange={(o) => !o && setMerging(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Merge {merging?.business_name} into this lead?</DialogTitle>
              <DialogDescription>
                Its timeline and follow-ups move here, and any details this lead is missing are
                copied over. {merging?.business_name} is then removed from the lists. This can’t be
                undone from the panel.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant='outline' onClick={() => setMerging(null)}>
                Cancel
              </Button>
              <Button
                disabled={merge.isPending}
                onClick={() =>
                  merging &&
                  merge.mutate(merging.id, {
                    onSuccess: () => {
                      toast.success(`${merging.business_name} merged`);
                      setMerging(null);
                    },
                    onError
                  })
                }
              >
                {merge.isPending ? 'Merging…' : 'Merge'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canDelete && (
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this lead?</DialogTitle>
              <DialogDescription>
                {lead.businessName} disappears from every list and report. The audit log keeps a
                record that you deleted it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant='outline' onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant='destructive'
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      toast.success('Lead deleted');
                      router.replace('/dashboard/leads');
                    },
                    onError
                  })
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
