'use client';

import { useState } from 'react';
import { LEAD_LOST_REASONS, type LeadLostReason } from '@restrovia/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { LOST_REASON_LABELS } from './labels';

/** Asks why a lead (or several) was lost; the reason feeds the lost-reasons report. */
export function LostDialog({
  open,
  onClose,
  onConfirm,
  pending,
  title = 'Mark as lost',
  showNote = true
}: {
  title?: string;
  showNote?: boolean;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: LeadLostReason, note: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState<LeadLostReason>('no_response');
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason, note.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              The reason feeds the lost-reasons report. You can reopen the lead later.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='lost_reason'>Reason</Label>
            <NativeSelect
              id='lost_reason'
              className='w-full'
              value={reason}
              onChange={(e) => setReason(e.target.value as LeadLostReason)}
            >
              {LEAD_LOST_REASONS.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {LOST_REASON_LABELS[r]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {showNote && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='lost_note'>Note (optional)</Label>
              <Textarea
                id='lost_note'
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' variant='destructive' disabled={pending}>
              {pending ? 'Saving…' : 'Mark lost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
