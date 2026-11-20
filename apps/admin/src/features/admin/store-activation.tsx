'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useCan } from '@/features/auth/use-admin';
import { adminApi, errorMessage } from '@/lib/api-client';
import { storeCode, timeAgo } from '@/lib/display';
import {
  type StoreDetail,
  useChangeLicence,
  useMoveDevice,
  useStores
} from './api';

const TRIAL_DAYS = 30;

type Target = { id: string; name: string };

/**
 * Shown on a store waiting for activation: its computer already had a trial with another store.
 * Support either moves the POS to that store (a reinstall) or starts a trial (a resold computer).
 */
export function PendingActivationCard({ data }: { data: StoreDetail }) {
  const canLicence = useCan('stores.licence');
  const canMove = useCan('stores.devices');
  const change = useChangeLicence(data.store.id);
  const [moving, setMoving] = useState(false);
  if (data.store.activation !== 'pending' || data.store.status === 'deleted') return null;
  const device = data.devices.find((d) => !d.revoked_at);
  const suggested = data.suggested_store;

  return (
    <Alert>
      <AlertTitle>Waiting for activation</AlertTitle>
      <AlertDescription className='flex flex-col gap-3'>
        <p>
          This computer already had a trial
          {suggested ? (
            <>
              {' '}
              with{' '}
              <Link href={`/dashboard/stores/${suggested.id}`} className='font-medium underline'>
                {suggested.name || 'Unnamed store'}
              </Link>{' '}
              ({storeCode(suggested.id)}
              {suggested.phone ? `, ${suggested.phone}` : ''})
            </>
          ) : (
            ' with a store that was deleted'
          )}
          , so this store got no trial. The POS keeps billing for 5 days from its first start, then
          stops until you act. If it is the same café, move the POS to its store. If the computer
          now belongs to a different café, start a trial.
        </p>
        <div className='flex flex-wrap gap-2'>
          {canMove && device && (
            <Button size='sm' onClick={() => setMoving(true)}>
              {suggested ? `Move to ${suggested.name || 'that store'}` : 'Move to existing store'}
            </Button>
          )}
          {canLicence && (
            <Button
              size='sm'
              variant='outline'
              disabled={change.isPending}
              onClick={() =>
                change.mutate(
                  {
                    action: 'extend_trial',
                    days: TRIAL_DAYS,
                    note: 'Trial started for a computer that had one before'
                  },
                  {
                    onSuccess: () => toast.success(`${TRIAL_DAYS}-day trial started`),
                    onError: (err) => toast.error(errorMessage(err))
                  }
                )
              }
            >
              Start {TRIAL_DAYS}-day trial
            </Button>
          )}
        </div>
      </AlertDescription>
      {device && (
        <MoveDeviceDialog
          open={moving}
          onClose={() => setMoving(false)}
          storeId={data.store.id}
          deviceId={device.id}
          initialTarget={suggested}
        />
      )}
    </Alert>
  );
}

/** Picks the store to move a POS into and which of that store's computers to switch off. */
export function MoveDeviceDialog({
  open,
  onClose,
  storeId,
  deviceId,
  initialTarget
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  deviceId: string;
  initialTarget?: Target | null;
}) {
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Target | null>(initialTarget ?? null);
  const [retire, setRetire] = useState<string>('auto');
  const router = useRouter();
  const move = useMoveDevice(storeId);
  const found = useStores({ search: search.trim() || undefined, page: 1, per_page: 5 });
  const targetDetail = useQuery({
    queryKey: ['store', target?.id],
    queryFn: () => adminApi<StoreDetail>(`/stores/${target!.id}`),
    enabled: open && !!target
  });
  const targetDevices = (targetDetail.data?.devices ?? []).filter((d) => !d.revoked_at);
  const candidates = (found.data?.data ?? []).filter(
    (s) => s.id !== storeId && s.status !== 'deleted'
  );

  const submit = () => {
    if (!target) return;
    move.mutate(
      {
        deviceId,
        target_store_id: target.id,
        retire_device_id: retire === 'auto' ? null : retire
      },
      {
        onSuccess: (r) => {
          toast.success(
            r.removed_store_id
              ? 'POS moved. The empty store was removed.'
              : 'POS moved. It picks up the new licence within a minute.'
          );
          onClose();
          if (r.store_id !== storeId) router.push(`/dashboard/stores/${r.store_id}`);
        },
        onError: (err) => toast.error(errorMessage(err))
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move POS to an existing store</DialogTitle>
          <DialogDescription>
            The POS joins that store and keeps its trial or plan. Its cloud orders move with it.
            If this store has no other POS, it is removed.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='move-search'>Store</Label>
          {target ? (
            <div className='flex items-center justify-between gap-2 rounded-md border p-2 text-sm'>
              <span>
                {target.name || 'Unnamed store'}{' '}
                <span className='text-muted-foreground font-mono'>{storeCode(target.id)}</span>
              </span>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => {
                  setTarget(null);
                  setRetire('auto');
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input
                id='move-search'
                placeholder='Name, phone or store code'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ul className='flex flex-col gap-1'>
                {candidates.map((s) => (
                  <li key={s.id}>
                    <Button
                      variant='outline'
                      size='sm'
                      className='w-full justify-between'
                      onClick={() => setTarget({ id: s.id, name: s.name })}
                    >
                      <span className='truncate'>{s.name || 'Unnamed store'}</span>
                      <span className='text-muted-foreground font-mono text-xs'>
                        {storeCode(s.id)}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {target && (
          <div className='flex flex-col gap-2'>
            <Label htmlFor='move-retire'>Switch off in that store</Label>
            <NativeSelect
              id='move-retire'
              className='w-full'
              value={retire}
              onChange={(e) => setRetire(e.target.value)}
            >
              <NativeSelectOption value='auto'>
                The POS on this same computer, if any
              </NativeSelectOption>
              {targetDevices.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {d.device_name ?? 'Unnamed'} ({d.platform ?? 'unknown'}), seen{' '}
                  {timeAgo(d.last_seen_at)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!target || move.isPending} onClick={submit}>
            {move.isPending ? 'Moving…' : 'Move POS'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
