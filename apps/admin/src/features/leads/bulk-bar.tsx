'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LEAD_STAGES, type LeadStage } from '@restrovia/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { type BulkAction, useAssignees, useBulkLeads } from './api';
import { STAGE_LABELS } from './labels';
import { LostDialog } from './lost-dialog';

const BULK_STAGES = LEAD_STAGES.filter((s): s is Exclude<LeadStage, 'won'> => s !== 'won');

/** Actions for the leads ticked in the list. Won is left out: each won lead needs its store. */
export function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const canDelete = useCan('leads.delete');
  const assignees = useAssignees();
  const bulk = useBulkLeads();
  const [tag, setTag] = useState('');
  const [losing, setLosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const n = ids.length;

  const run = (action: BulkAction, done: string) =>
    bulk.mutate(
      { ...action, ids },
      {
        onSuccess: (r) => {
          toast.success(
            r.changed === n ? `${done} (${n} leads)` : `${done} (${r.changed} of ${n} leads)`
          );
          onDone();
        },
        onError: (err) => toast.error(errorMessage(err))
      }
    );

  return (
    <div
      role='toolbar'
      aria-label='Bulk actions'
      className='bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm'
    >
      <span className='px-1 font-medium'>{n} selected</span>
      <NativeSelect
        size='sm'
        aria-label='Give selected leads to'
        value=''
        disabled={bulk.isPending}
        onChange={(e) => {
          const v = e.target.value;
          if (v) run({ action: 'assign', admin_id: v === 'none' ? null : v }, 'Owner changed');
        }}
      >
        <NativeSelectOption value=''>Set owner…</NativeSelectOption>
        <NativeSelectOption value='none'>Unassigned</NativeSelectOption>
        {assignees.data?.map((a) => (
          <NativeSelectOption key={a.id} value={a.id}>
            {a.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        size='sm'
        aria-label='Move selected leads to stage'
        value=''
        disabled={bulk.isPending}
        onChange={(e) => {
          const stage = e.target.value as Exclude<LeadStage, 'won'> | '';
          if (!stage) return;
          if (stage === 'lost') setLosing(true);
          else run({ action: 'stage', stage }, `Moved to ${STAGE_LABELS[stage]}`);
        }}
      >
        <NativeSelectOption value=''>Move to stage…</NativeSelectOption>
        {BULK_STAGES.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {STAGE_LABELS[s]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <form
        className='flex items-center gap-1'
        onSubmit={(e) => {
          e.preventDefault();
          if (!tag.trim()) return;
          run({ action: 'tag', tag: tag.trim() }, 'Tag added');
          setTag('');
        }}
      >
        <Input
          aria-label='Tag to add'
          placeholder='Add tag'
          className='h-7 w-28'
          maxLength={40}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <Button type='submit' size='sm' variant='outline' disabled={!tag.trim() || bulk.isPending}>
          Add
        </Button>
      </form>
      {canDelete && (
        <Button
          size='sm'
          variant='ghost'
          className='text-destructive'
          disabled={bulk.isPending}
          onClick={() => setDeleting(true)}
        >
          Delete
        </Button>
      )}
      <Button size='sm' variant='ghost' className='ml-auto' onClick={onDone}>
        Clear selection
      </Button>

      <LostDialog
        open={losing}
        title={`Mark ${n} leads as lost`}
        showNote={false}
        pending={bulk.isPending}
        onClose={() => setLosing(false)}
        onConfirm={(reason) => {
          setLosing(false);
          run({ action: 'stage', stage: 'lost', lost_reason: reason }, 'Marked lost');
        }}
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {n} leads?</DialogTitle>
            <DialogDescription>
              They disappear from every list and report. The audit log keeps a record of each.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              disabled={bulk.isPending}
              onClick={() => {
                setDeleting(false);
                run({ action: 'delete' }, 'Deleted');
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
