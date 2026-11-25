'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { POLICY_LOCKS } from '@restrovia/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDay } from '@/lib/display';
import {
  type Plan,
  type PlanLock,
  type StoreDetail,
  useStoreLockChange,
  useStoreLocks,
  useUpdatePlan
} from './api';
import { QueryState } from './ui';

const LABEL = new Map<string, string>(POLICY_LOCKS.map((l) => [l.key, l.label]));
const MODE_LABEL = { hidden: 'Hidden', read_only: 'Read-only' } as const;
const label = (key: string) => LABEL.get(key) ?? key;

function AddLockDialog({ data, onClose }: { data: StoreDetail; onClose: () => void }) {
  const change = useStoreLockChange(data.store.id);
  const [key, setKey] = useState<string>(POLICY_LOCKS[0].key);
  const [effect, setEffect] = useState<'lock' | 'unlock'>('lock');
  const [mode, setMode] = useState<'hidden' | 'read_only'>('read_only');
  const [deviceId, setDeviceId] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    change.mutate(
      {
        kind: 'add',
        body: {
          key,
          mode,
          effect,
          reason,
          ...(endsOn && { ends_at: new Date(`${endsOn}T23:59:59`).toISOString() }),
          ...(effect === 'lock' && deviceId && { pos_device_id: deviceId })
        }
      },
      {
        onSuccess: () => {
          toast.success(effect === 'unlock' ? 'Plan lock lifted for this store' : 'Lock added');
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err))
      }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Lock a page or setting</DialogTitle>
            <DialogDescription>
              The POS picks it up within a minute when online, and within 5 days when offline.
              Billing, orders, payments, the kitchen screen, printing, reports and backups are never
              locked.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='lock-key'>What</Label>
            <NativeSelect
              id='lock-key'
              className='w-full'
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {POLICY_LOCKS.map((l) => (
                <NativeSelectOption key={l.key} value={l.key}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='lock-effect'>Action</Label>
              <NativeSelect
                id='lock-effect'
                className='w-full'
                value={effect}
                onChange={(e) => setEffect(e.target.value as 'lock' | 'unlock')}
              >
                <NativeSelectOption value='lock'>Lock</NativeSelectOption>
                <NativeSelectOption value='unlock'>Lift the plan’s lock</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='lock-mode'>How</Label>
              <NativeSelect
                id='lock-mode'
                className='w-full'
                value={mode}
                disabled={effect === 'unlock'}
                onChange={(e) => setMode(e.target.value as 'hidden' | 'read_only')}
              >
                <NativeSelectOption value='read_only'>Read-only (visible)</NativeSelectOption>
                <NativeSelectOption value='hidden'>Hidden</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='lock-device'>On</Label>
              <NativeSelect
                id='lock-device'
                className='w-full'
                value={deviceId}
                disabled={effect === 'unlock'}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                <NativeSelectOption value=''>Every POS of this store</NativeSelectOption>
                {data.devices.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.device_name || d.id.slice(0, 8)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='lock-ends'>Until (optional)</Label>
              <Input
                id='lock-ends'
                type='date'
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='lock-reason'>Reason staff will see</Label>
            <Textarea
              id='lock-reason'
              required
              minLength={3}
              maxLength={500}
              placeholder='For example: Not included in your plan. Contact Restrovia support.'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={change.isPending}>
              {change.isPending ? 'Saving…' : effect === 'unlock' ? 'Lift lock' : 'Add lock'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A store's locks: from its plan, its own, and per POS install. */
export function StoreLocksCard({ data }: { data: StoreDetail }) {
  const canChange = useCan('stores.licence');
  const locks = useStoreLocks(data.store.id);
  const change = useStoreLockChange(data.store.id);
  const [adding, setAdding] = useState(false);

  const remove = (id: string) => {
    const note = window.prompt('Why are you removing this lock?');
    if (!note || note.trim().length < 3) return;
    change.mutate(
      { kind: 'remove', id, note: note.trim() },
      {
        onSuccess: () => toast.success('Lock removed'),
        onError: (err) => toast.error(errorMessage(err))
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between gap-2 text-base'>
          Locks
          {canChange && (
            <Button size='sm' variant='outline' onClick={() => setAdding(true)}>
              Add
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3 text-sm'>
        {!locks.data ? (
          <QueryState isPending={locks.isPending} error={locks.error} />
        ) : (
          <>
            {locks.data.plan && locks.data.plan.locks.length > 0 && (
              <div className='text-muted-foreground text-xs'>
                From the {locks.data.plan.name} plan:{' '}
                {locks.data.plan.locks
                  .map((l) => `${label(l.key)} (${MODE_LABEL[l.mode as 'hidden']})`)
                  .join(', ')}
              </div>
            )}
            {locks.data.locks.length === 0 ? (
              <p className='text-muted-foreground'>No locks on this store.</p>
            ) : (
              <ul className='flex flex-col gap-3'>
                {locks.data.locks.map((l) => (
                  <li key={l.id} className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <div className='font-medium'>
                        {l.effect === 'unlock' ? 'Lifted: ' : ''}
                        {label(l.key)}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        {l.device_name ? `${l.device_name} only` : 'Every POS'}
                        {l.ends_at ? ` · until ${formatDay(l.ends_at)}` : ''} · {l.reason}
                      </div>
                    </div>
                    <div className='flex items-center gap-2'>
                      {l.effect === 'lock' && (
                        <Badge variant='outline'>{MODE_LABEL[l.mode]}</Badge>
                      )}
                      {canChange && (
                        <Button size='sm' variant='ghost' onClick={() => remove(l.id)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
      {adding && <AddLockDialog data={data} onClose={() => setAdding(false)} />}
    </Card>
  );
}

/** Which pages and settings every store on a plan has locked. */
export function PlanLocksDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const update = useUpdatePlan();
  const [locks, setLocks] = useState<Record<string, PlanLock | undefined>>(() =>
    Object.fromEntries((plan.locks ?? []).map((l) => [l.key, l]))
  );
  const set = (key: string, value: PlanLock | undefined) =>
    setLocks((all) => ({ ...all, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = Object.values(locks).filter((l): l is PlanLock => !!l);
    if (chosen.some((l) => l.reason.trim().length < 3)) {
      toast.error('Give each lock a reason of at least 3 characters.');
      return;
    }
    update.mutate(
      { id: plan.id, changes: { locks: chosen } },
      {
        onSuccess: () => {
          toast.success('Plan locks saved');
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err))
      }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto'>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Locks for {plan.name}</DialogTitle>
            <DialogDescription>
              Every store on this plan gets these. A store page can lift one for a single store, and
              an add-on the store owns lifts its own page’s lock.
            </DialogDescription>
          </DialogHeader>
          {POLICY_LOCKS.map((l) => {
            const current = locks[l.key];
            return (
              <div key={l.key} className='flex flex-col gap-2 rounded-md border p-3'>
                <Label className='flex items-center gap-2 font-normal'>
                  <input
                    type='checkbox'
                    checked={!!current}
                    onChange={(e) =>
                      set(
                        l.key,
                        e.target.checked
                          ? { key: l.key, mode: 'hidden', reason: 'Not included in your plan.' }
                          : undefined
                      )
                    }
                  />
                  {l.label}
                </Label>
                {current && (
                  <div className='grid grid-cols-[8rem_1fr] gap-2'>
                    <NativeSelect
                      aria-label={`${l.label}: how`}
                      value={current.mode}
                      onChange={(e) =>
                        set(l.key, { ...current, mode: e.target.value as PlanLock['mode'] })
                      }
                    >
                      <NativeSelectOption value='hidden'>Hidden</NativeSelectOption>
                      <NativeSelectOption value='read_only'>Read-only</NativeSelectOption>
                    </NativeSelect>
                    <Input
                      aria-label={`${l.label}: reason`}
                      maxLength={500}
                      value={current.reason}
                      onChange={(e) => set(l.key, { ...current, reason: e.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save locks'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
