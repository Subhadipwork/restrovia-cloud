'use client';

import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { LEAD_CALL_OUTCOMES, type LeadCallOutcome } from '@restrovia/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { QueryState } from '@/features/admin/ui';
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/display';
import { cn } from '@/lib/utils';
import { type LeadTask, useAssignees, useLeadTasks, useTaskAction } from './api';
import { OUTCOME_LABELS, TASK_TYPE_LABELS, waNumber } from './labels';
import { StageBadge } from './stage-badge';

const HOUR = 3_600_000;
const onError = (err: unknown) => toast.error(errorMessage(err));

/** Start of tomorrow in the viewer's time zone. */
function startOfTomorrow(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function TaskItem({ task, now }: { task: LeadTask; now: number }) {
  const action = useTaskAction();
  const [logging, setLogging] = useState(false);
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState<LeadCallOutcome>('connected');
  const overdue = new Date(task.due_at).getTime() < now;
  const base = { taskId: task.id, leadId: task.lead_id };
  const snooze = (ms: number) =>
    action.mutate(
      { ...base, due_at: new Date(Date.now() + ms).toISOString() },
      { onSuccess: () => toast.success('Snoozed'), onError }
    );
  const tomorrow9 = startOfTomorrow(now) + 9 * HOUR - now;

  return (
    <li className='rounded-lg border p-3 text-sm'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <Link href={`/dashboard/leads/${task.lead_id}`} className='font-medium hover:underline'>
              {task.lead_name}
            </Link>
            <StageBadge stage={task.lead_stage} />
          </div>
          <div>
            {TASK_TYPE_LABELS[task.type]}: {task.title}
          </div>
          <div className={cn('text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
            {overdue && 'Overdue · '}
            {formatDateTime(task.due_at)}
            {task.assigned_admin_name && ` · ${task.assigned_admin_name}`}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-1'>
          {task.lead_phone && task.type === 'call' && (
            <a
              href={`tel:${task.lead_phone}`}
              className='text-muted-foreground px-2 text-xs hover:underline'
            >
              {task.lead_phone}
            </a>
          )}
          {task.lead_phone && task.type === 'whatsapp' && (
            <a
              href={`https://wa.me/${waNumber(task.lead_phone)}`}
              target='_blank'
              rel='noopener noreferrer'
              className='text-muted-foreground px-2 text-xs hover:underline'
            >
              Open WhatsApp
            </a>
          )}
          <Button
            size='sm'
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { ...base, done: true },
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
            size='sm'
            aria-label={`Snooze ${task.title}`}
            value=''
            onChange={(e) => e.target.value && snooze(Number(e.target.value))}
          >
            <NativeSelectOption value=''>Snooze…</NativeSelectOption>
            <NativeSelectOption value={String(HOUR)}>1 hour</NativeSelectOption>
            <NativeSelectOption value={String(Math.max(tomorrow9, HOUR))}>
              Tomorrow 9 am
            </NativeSelectOption>
            <NativeSelectOption value={String(3 * 24 * HOUR)}>3 days</NativeSelectOption>
            <NativeSelectOption value={String(7 * 24 * HOUR)}>1 week</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      {logging && (
        <form
          className='mt-3 flex flex-col gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(
              {
                ...base,
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
          <Button type='submit' size='sm' className='self-start' disabled={action.isPending}>
            Save
          </Button>
        </form>
      )}
    </li>
  );
}

function Group({
  title,
  tasks,
  now,
  empty,
  tone
}: {
  title: string;
  tasks: LeadTask[];
  now: number;
  empty: string;
  tone?: 'danger';
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle
          className={cn('text-base', tone === 'danger' && tasks.length && 'text-destructive')}
        >
          {title} <span className='text-muted-foreground font-normal'>({tasks.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{empty}</p>
        ) : (
          <ul className='flex flex-col gap-2'>
            {tasks.map((t) => (
              <TaskItem key={t.id} task={t} now={now} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function FollowUpsScreen() {
  const seesTeam = useCan('users.view');
  const [assigned, setAssigned] = useQueryState('assigned', parseAsString.withDefault('me'));
  const assignees = useAssignees();
  const { data, isPending, error } = useLeadTasks({ assigned, due: 'week' });
  const [now] = useState(() => Date.now());
  const tomorrow = startOfTomorrow(now);

  return (
    <div className='flex flex-col gap-4'>
      {seesTeam && (
        <NativeSelect
          aria-label='Whose follow-ups'
          className='self-start'
          value={assigned}
          onChange={(e) => void setAssigned(e.target.value)}
        >
          <NativeSelectOption value='me'>Mine</NativeSelectOption>
          <NativeSelectOption value='all'>Everyone</NativeSelectOption>
          <NativeSelectOption value='none'>Unassigned</NativeSelectOption>
          {assignees.data?.map((a) => (
            <NativeSelectOption key={a.id} value={a.id}>
              {a.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      {!data ? (
        <QueryState isPending={isPending} error={error} rows={4} />
      ) : (
        <>
          <Group
            title='Overdue'
            tone='danger'
            now={now}
            tasks={data.filter((t) => new Date(t.due_at).getTime() < now)}
            empty='Nothing overdue.'
          />
          <Group
            title='Today'
            now={now}
            tasks={data.filter((t) => {
              const due = new Date(t.due_at).getTime();
              return due >= now && due < tomorrow;
            })}
            empty='Nothing else due today.'
          />
          <Group
            title='Next 7 days'
            now={now}
            tasks={data.filter((t) => new Date(t.due_at).getTime() >= tomorrow)}
            empty='Nothing planned for the coming week.'
          />
        </>
      )}
    </div>
  );
}
