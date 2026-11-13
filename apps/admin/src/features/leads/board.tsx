'use client';

import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  LEAD_TEMPERATURES,
  type LeadLostReason,
  type LeadStage
} from '@restrovia/shared';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { QueryState } from '@/features/admin/ui';
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDay, formatMoney } from '@/lib/display';
import { cn } from '@/lib/utils';
import { type BoardCard, useAssignees, useBoard, useMoveCard } from './api';
import {
  SOURCE_LABELS,
  STAGE_COLOURS,
  STAGE_LABELS,
  TEMPERATURE_DOT,
  TEMPERATURE_LABELS
} from './labels';
import { LostDialog } from './lost-dialog';

const DRAG_TYPE = 'application/x-restrovia-lead';

function Card({
  card,
  now,
  onMove
}: {
  card: BoardCard;
  now: number;
  onMove: (card: BoardCard, stage: LeadStage) => void;
}) {
  const overdue = card.next_follow_up_at && new Date(card.next_follow_up_at).getTime() < now;
  return (
    // Dragging is a mouse shortcut; the stage menu on the card does the same from the keyboard.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(card));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className='bg-card cursor-grab rounded-lg border p-3 text-sm shadow-xs active:cursor-grabbing'
    >
      <div className='flex items-start gap-2'>
        <span
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', TEMPERATURE_DOT[card.temperature])}
          title={TEMPERATURE_LABELS[card.temperature]}
        />
        <div className='min-w-0 flex-1'>
          <Link
            href={`/dashboard/leads/${card.id}`}
            className='block truncate font-medium hover:underline'
            draggable={false}
          >
            {card.business_name}
          </Link>
          <div className='text-muted-foreground truncate text-xs'>
            {[card.area, card.city].filter(Boolean).join(', ') || '—'}
          </div>
        </div>
      </div>
      <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        {card.expected_value && <span>{formatMoney(card.expected_value)}/mo</span>}
        {card.next_follow_up_at && (
          <span className={cn(overdue && 'text-destructive font-medium')}>
            {overdue ? 'Overdue · ' : 'Next: '}
            {formatDay(card.next_follow_up_at)}
          </span>
        )}
        <span className='ml-auto'>{card.assigned_admin_name ?? 'Unassigned'}</span>
      </div>
      <NativeSelect
        size='sm'
        aria-label={`Move ${card.business_name}`}
        className='mt-2 w-full'
        value={card.stage}
        onChange={(e) => onMove(card, e.target.value as LeadStage)}
      >
        {LEAD_STAGES.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {s === card.stage ? STAGE_LABELS[s] : `Move to ${STAGE_LABELS[s]}`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </li>
  );
}

export function BoardScreen() {
  const canWinWithoutStore = useCan('leads.win_override');
  const [params, setParams] = useQueryStates({
    assigned: parseAsString.withDefault(''),
    source: parseAsString.withDefault(''),
    temperature: parseAsString.withDefault('')
  });
  const assignees = useAssignees();
  const { data, isPending, error } = useBoard({
    assigned: params.assigned || undefined,
    source: params.source || undefined,
    temperature: params.temperature || undefined
  });
  const move = useMoveCard();
  const [losing, setLosing] = useState<BoardCard | null>(null);
  const [dropOn, setDropOn] = useState<LeadStage | null>(null);
  const [now] = useState(() => Date.now());

  const send = (card: BoardCard, stage: LeadStage, lostReason?: LeadLostReason) =>
    move.mutate(
      { id: card.id, stage, lost_reason: lostReason },
      {
        onSuccess: () => toast.success(`${card.business_name} → ${STAGE_LABELS[stage]}`),
        onError: (err) => toast.error(errorMessage(err))
      }
    );

  const onMove = (card: BoardCard, stage: LeadStage) => {
    if (stage === card.stage) return;
    if (stage === 'won' && !card.store_id && !canWinWithoutStore) {
      toast.error('Link the customer’s store on the lead page before marking it won.');
      return;
    }
    if (stage === 'lost') {
      setLosing(card);
      return;
    }
    send(card, stage);
  };

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex flex-wrap gap-2'>
        <NativeSelect
          aria-label='Owner'
          value={params.assigned}
          onChange={(e) => void setParams({ assigned: e.target.value })}
        >
          <NativeSelectOption value=''>Any owner</NativeSelectOption>
          <NativeSelectOption value='me'>My leads</NativeSelectOption>
          <NativeSelectOption value='none'>Unassigned</NativeSelectOption>
          {assignees.data?.map((a) => (
            <NativeSelectOption key={a.id} value={a.id}>
              {a.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label='Source'
          value={params.source}
          onChange={(e) => void setParams({ source: e.target.value })}
        >
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
          onChange={(e) => void setParams({ temperature: e.target.value })}
        >
          <NativeSelectOption value=''>Any temperature</NativeSelectOption>
          {LEAD_TEMPERATURES.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {TEMPERATURE_LABELS[t]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className='text-muted-foreground self-center text-xs'>
          Drag a card to another column, or use the menu on the card.
        </p>
      </div>

      {!data ? (
        <QueryState isPending={isPending} error={error} rows={4} />
      ) : (
        // Inline-size containment stops the wide board from widening the page; it scrolls instead.
        <div className='-mx-4 overflow-x-auto px-4 pb-2 [contain:inline-size] md:-mx-6 md:px-6'>
          <div className='flex gap-3'>
            {data.columns.map((col) => {
              const closed = col.stage === 'won' || col.stage === 'lost';
              return (
                // A drop target only; keyboard and touch users move cards with the card's menu.
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <section
                  key={col.stage}
                  aria-label={STAGE_LABELS[col.stage]}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                    e.preventDefault();
                    setDropOn(col.stage);
                  }}
                  onDragLeave={() => setDropOn((s) => (s === col.stage ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropOn(null);
                    const raw = e.dataTransfer.getData(DRAG_TYPE);
                    if (raw) onMove(JSON.parse(raw) as BoardCard, col.stage);
                  }}
                  className={cn(
                    'bg-muted/40 flex w-64 shrink-0 flex-col rounded-xl border-t-4 p-2 transition-colors',
                    STAGE_COLOURS[col.stage].line,
                    dropOn === col.stage && 'bg-muted ring-ring/50 ring-2'
                  )}
                >
                  <header className='flex items-baseline justify-between gap-2 px-1 pb-2'>
                    <h2 className='text-sm font-semibold'>
                      {STAGE_LABELS[col.stage]}
                      {closed && (
                        <span className='text-muted-foreground font-normal'> · this month</span>
                      )}
                    </h2>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {col.count}
                      {Number(col.value) > 0 && ` · ${formatMoney(col.value)}`}
                    </span>
                  </header>
                  <ul className='flex min-h-24 flex-col gap-2'>
                    {col.cards.map((c) => (
                      <Card key={c.id} card={c} now={now} onMove={onMove} />
                    ))}
                    {col.cards.length === 0 && (
                      <li className='text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs'>
                        Drop a lead here
                      </li>
                    )}
                  </ul>
                  {col.count > col.cards.length && (
                    <Link
                      href={`/dashboard/leads?stage=${col.stage}`}
                      className='text-muted-foreground mt-2 px-1 text-xs hover:underline'
                    >
                      {col.count - col.cards.length} more in the list
                    </Link>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <LostDialog
        key={losing?.id ?? 'none'}
        open={!!losing}
        title={losing ? `Mark ${losing.business_name} as lost` : undefined}
        showNote={false}
        pending={move.isPending}
        onClose={() => setLosing(null)}
        onConfirm={(reason) => {
          if (losing) send(losing, 'lost', reason);
          setLosing(null);
        }}
      />
    </div>
  );
}
