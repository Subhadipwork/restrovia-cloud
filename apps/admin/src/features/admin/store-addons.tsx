'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { formatDay, formatMoney } from '@/lib/display';
import { addonPrice } from './addons';
import { type StoreAddon, useAddons, useStoreAddonChange, useStoreAddons } from './api';
import { QueryState } from './ui';

const STATUS_LABELS: Record<StoreAddon['status'], string> = {
  trial: 'Trial',
  active: 'Active',
  cancelled: 'Cancelled',
  expired: 'Ended',
  revoked: 'Stopped'
};
const SOURCE_LABELS: Record<StoreAddon['source'], string> = {
  purchase: 'Bought',
  free: 'Free',
  admin_grant: 'Given by Restrovia',
  grandfathered: 'Kept from before'
};

type DialogState =
  | { kind: 'add' }
  | { kind: 'payment'; row: StoreAddon }
  | { kind: 'revoke'; row: StoreAddon }
  | null;

function AddDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const catalogue = useAddons();
  const change = useStoreAddonChange(storeId);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'grant' | 'trial'>('grant');
  const [source, setSource] = useState<StoreAddon['source']>('purchase');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const addon = catalogue.data?.find((a) => a.code === code) ?? catalogue.data?.[0];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addon) return;
    change.mutate(
      {
        kind: 'add',
        body:
          mode === 'trial'
            ? { action: 'trial', addon_code: addon.code, ...(note && { note }) }
            : {
                action: 'grant',
                addon_code: addon.code,
                source,
                ...(amount && { amount }),
                note
              }
      },
      {
        onSuccess: () => {
          toast.success(mode === 'trial' ? 'Trial started' : `${addon.name} added`);
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
            <DialogTitle>Add an add-on</DialogTitle>
            <DialogDescription>
              A paid add-on runs for one billing period from today. The POS picks it up within a
              minute when it is online.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='store-addon'>Add-on</Label>
            <NativeSelect
              id='store-addon'
              className='w-full'
              value={addon?.code ?? ''}
              onChange={(e) => setCode(e.target.value)}
            >
              {catalogue.data?.map((a) => (
                <NativeSelectOption key={a.code} value={a.code}>
                  {a.name} — {addonPrice(a)}
                  {a.status !== 'live' ? ` (${a.status})` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='store-addon-mode'>How</Label>
            <NativeSelect
              id='store-addon-mode'
              className='w-full'
              value={mode}
              onChange={(e) => setMode(e.target.value as 'grant' | 'trial')}
            >
              <NativeSelectOption value='grant'>Add now</NativeSelectOption>
              <NativeSelectOption value='trial' disabled={!addon?.trial_days}>
                Start free trial{addon?.trial_days ? ` (${addon.trial_days} days)` : ' (none)'}
              </NativeSelectOption>
            </NativeSelect>
          </div>
          {mode === 'grant' && (
            <div className='grid grid-cols-2 gap-4'>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='store-addon-source'>Reason</Label>
                <NativeSelect
                  id='store-addon-source'
                  className='w-full'
                  value={source}
                  onChange={(e) => setSource(e.target.value as StoreAddon['source'])}
                >
                  {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                    <NativeSelectOption key={v} value={v}>
                      {l}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='store-addon-amount'>Payment received</Label>
                <Input
                  id='store-addon-amount'
                  inputMode='decimal'
                  pattern='\d{1,8}(\.\d{1,2})?'
                  placeholder={addon ? String(Number(addon.price)) : ''}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className='flex flex-col gap-2'>
            <Label htmlFor='store-addon-note'>
              Note{mode === 'grant' ? '' : ' (optional)'}
            </Label>
            <Textarea
              id='store-addon-note'
              required={mode === 'grant'}
              minLength={mode === 'grant' ? 3 : undefined}
              maxLength={500}
              placeholder='For example: paid by UPI, ref 1234'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={change.isPending || !addon}>
              {change.isPending ? 'Saving…' : mode === 'trial' ? 'Start trial' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowDialog({
  storeId,
  state,
  onClose
}: {
  storeId: string;
  state: Exclude<DialogState, { kind: 'add' } | null>;
  onClose: () => void;
}) {
  const change = useStoreAddonChange(storeId);
  const [amount, setAmount] = useState(String(Number(state.row.price)));
  const [immediate, setImmediate] = useState(false);
  const [note, setNote] = useState('');
  const isPayment = state.kind === 'payment';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    change.mutate(
      isPayment
        ? { kind: 'payment', id: state.row.id, body: { amount, ...(note && { note }) } }
        : { kind: 'revoke', id: state.row.id, body: { immediate, note } },
      {
        onSuccess: () => {
          toast.success(
            isPayment
              ? 'Payment recorded'
              : immediate
                ? 'Add-on stopped'
                : 'Add-on cancelled; it works until its end date'
          );
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
            <DialogTitle>
              {isPayment ? `Renew ${state.row.addon_name}` : `Stop ${state.row.addon_name}`}
            </DialogTitle>
            <DialogDescription>
              {isPayment
                ? 'Adds one billing period after the current end date, or from today if it has ended.'
                : 'Without “Stop now” it keeps working until its paid end date. A trial, or an add-on with no end date, stops at once.'}
            </DialogDescription>
          </DialogHeader>
          {isPayment ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='renew-amount'>Payment received</Label>
              <Input
                id='renew-amount'
                required
                inputMode='decimal'
                pattern='\d{1,8}(\.\d{1,2})?'
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          ) : (
            <Label className='flex items-center gap-2 font-normal'>
              <Checkbox checked={immediate} onCheckedChange={(v) => setImmediate(v === true)} />
              Stop now (for example after a refund)
            </Label>
          )}
          <div className='flex flex-col gap-2'>
            <Label htmlFor='row-note'>Note{isPayment ? ' (optional)' : ''}</Label>
            <Textarea
              id='row-note'
              required={!isPayment}
              minLength={isPayment ? undefined : 3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              type='submit'
              variant={isPayment ? 'default' : 'destructive'}
              disabled={change.isPending}
            >
              {change.isPending ? 'Saving…' : isPayment ? 'Record payment' : 'Stop add-on'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The store's add-ons: what it has now, until when, and the payments for each. */
export function StoreAddonsCard({ storeId }: { storeId: string }) {
  const canChange = useCan('stores.licence');
  const { data, isPending, error } = useStoreAddons(storeId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const current = data?.filter((a) => ['trial', 'active', 'cancelled'].includes(a.status)) ?? [];
  const past = data?.filter((a) => !current.includes(a)) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between gap-2 text-base'>
          Add-ons
          {canChange && (
            <Button size='sm' variant='outline' onClick={() => setDialog({ kind: 'add' })}>
              Add
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3 text-sm'>
        {!data ? (
          <QueryState isPending={isPending} error={error} />
        ) : current.length === 0 ? (
          <p className='text-muted-foreground'>No add-ons. The store uses its plan only.</p>
        ) : (
          <ul className='flex flex-col gap-3'>
            {current.map((a) => (
              <li key={a.id} className='flex flex-wrap items-start justify-between gap-2'>
                <div>
                  <div className='font-medium'>
                    {a.addon_name}
                    {a.quantity > 1 && <span className='text-muted-foreground'> × {a.quantity}</span>}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {SOURCE_LABELS[a.source]}
                    {Number(a.price) > 0 && ` · ${formatMoney(a.price, a.currency)}`}
                    {' · '}
                    {a.ends_at
                      ? `${a.in_use ? 'until' : 'ended'} ${formatDay(a.ends_at)}`
                      : 'no end date'}
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <Badge variant={a.in_use ? 'default' : 'outline'}>
                    {a.in_use ? STATUS_LABELS[a.status] : 'Ended'}
                  </Badge>
                  {canChange && (
                    <>
                      {a.ends_at && (a.interval === 'month' || a.interval === 'year') && (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setDialog({ kind: 'payment', row: a })}
                        >
                          Renew
                        </Button>
                      )}
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setDialog({ kind: 'revoke', row: a })}
                      >
                        Stop
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className='text-muted-foreground text-xs'>
            <summary className='cursor-pointer'>Earlier add-ons ({past.length})</summary>
            <ul className='mt-2 flex flex-col gap-1'>
              {past.map((a) => (
                <li key={a.id}>
                  {a.addon_name} · {STATUS_LABELS[a.status]} · {formatDay(a.created_at)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
      {dialog?.kind === 'add' && <AddDialog storeId={storeId} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind !== 'add' && (
        <RowDialog storeId={storeId} state={dialog} onClose={() => setDialog(null)} />
      )}
    </Card>
  );
}
