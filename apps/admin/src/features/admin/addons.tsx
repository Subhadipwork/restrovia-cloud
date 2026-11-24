'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatMoney } from '@/lib/display';
import { AddonRequestsCard } from './addon-requests';
import {
  type Addon,
  type AddonFields,
  useAddons,
  useCreateAddon,
  useUpdateAddon
} from './api';
import { EmptyRow, QueryState } from './ui';

export const ADDON_KIND_LABELS: Record<Addon['kind'], string> = {
  included: 'Included',
  free: 'Free',
  paid: 'Paid',
  per_unit: 'Per unit',
  usage: 'Usage pack',
  one_time: 'One time',
  contact: 'Contact sales'
};
const CATEGORY_LABELS: Record<Addon['category'], string> = {
  channels: 'Sales channels',
  operations: 'Operations',
  money: 'Money and compliance',
  marketing: 'Marketing',
  reports: 'Reports',
  services: 'Services'
};
const UNIT_LABELS: Record<Addon['unit'], string> = {
  outlet: 'outlet',
  device: 'POS computer',
  kiosk: 'kiosk',
  screen: 'screen',
  pack: 'pack'
};
const STATUS_LABELS: Record<Addon['status'], string> = {
  draft: 'Draft',
  beta: 'Beta',
  live: 'Live',
  retired: 'Retired'
};

/** "₹499 / month per kiosk", or "Free". */
export function addonPrice(a: Pick<Addon, 'price' | 'currency' | 'interval' | 'unit'>) {
  if (Number(a.price) === 0) return 'Free';
  const every =
    a.interval === 'month' || a.interval === 'year'
      ? ` / ${a.interval}`
      : a.interval === 'once'
        ? ' once'
        : '';
  const per = a.unit === 'outlet' ? '' : ` per ${UNIT_LABELS[a.unit]}`;
  return `${formatMoney(a.price, a.currency)}${every}${per}`;
}

type FormState = Omit<AddonFields, 'trial_days' | 'sort_order'> & {
  code: string;
  trial_days: string;
  sort_order: string;
};

function AddonDialog({ addon, onClose }: { addon: Addon | null; onClose: () => void }) {
  const create = useCreateAddon();
  const update = useUpdateAddon();
  const [form, setForm] = useState<FormState>(() => ({
    code: addon?.code ?? '',
    name: addon?.name ?? '',
    tagline: addon?.tagline ?? '',
    description: addon?.description ?? '',
    category: addon?.category ?? 'channels',
    kind: addon?.kind ?? 'paid',
    price: addon ? String(Number(addon.price)) : '0',
    interval: addon?.interval ?? 'month',
    unit: addon?.unit ?? 'outlet',
    trial_days: String(addon?.trial_days ?? 0),
    status: addon?.status ?? 'draft',
    sort_order: String(addon?.sort_order ?? 0)
  }));
  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const busy = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fields: AddonFields = {
      name: form.name,
      tagline: form.tagline,
      description: form.description,
      category: form.category,
      kind: form.kind,
      price: form.price,
      interval: form.interval,
      unit: form.unit,
      trial_days: Number(form.trial_days),
      status: form.status,
      sort_order: Number(form.sort_order)
    };
    const done = {
      onSuccess: () => {
        toast.success(addon ? 'Add-on saved' : 'Add-on added');
        onClose();
      },
      onError: (err: unknown) => toast.error(errorMessage(err))
    };
    if (addon) update.mutate({ id: addon.id, changes: fields }, done);
    else create.mutate({ code: form.code, ...fields }, done);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto'>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>{addon ? `Edit ${addon.name}` : 'Add an add-on'}</DialogTitle>
            <DialogDescription>
              {addon
                ? 'A new price applies to sales from now on. Stores that already have it keep the price they bought it at.'
                : 'Start it as a draft. Only live and beta add-ons will be shown to stores.'}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='addon-name'>Name stores see</Label>
            <Input
              id='addon-name'
              required
              maxLength={100}
              placeholder='WhatsApp delivery'
              value={form.name}
              onChange={set('name')}
            />
          </div>
          {!addon && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-code'>Code</Label>
              <Input
                id='addon-code'
                required
                pattern='[a-z][a-z0-9_]{1,62}'
                placeholder='whatsapp'
                value={form.code}
                onChange={set('code')}
              />
              <p className='text-muted-foreground text-xs'>
                Lowercase letters, digits and _. It can’t be changed later. The POS unlocks a
                feature by this code (whatsapp, tableside, kiosk, table_qr, online_ordering,
                cloud_kds).
              </p>
            </div>
          )}
          <div className='flex flex-col gap-2'>
            <Label htmlFor='addon-tagline'>One line</Label>
            <Input
              id='addon-tagline'
              maxLength={200}
              placeholder='Send bills and offers on WhatsApp.'
              value={form.tagline}
              onChange={set('tagline')}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='addon-description'>Description</Label>
            <Textarea
              id='addon-description'
              maxLength={5000}
              value={form.description}
              onChange={set('description')}
            />
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-category'>Category</Label>
              <NativeSelect
                id='addon-category'
                className='w-full'
                value={form.category}
                onChange={set('category')}
              >
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                  <NativeSelectOption key={v} value={v}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-kind'>Kind</Label>
              <NativeSelect
                id='addon-kind'
                className='w-full'
                value={form.kind}
                onChange={set('kind')}
              >
                {Object.entries(ADDON_KIND_LABELS).map(([v, l]) => (
                  <NativeSelectOption key={v} value={v}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className='grid grid-cols-3 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-price'>Price (₹)</Label>
              <Input
                id='addon-price'
                required
                inputMode='decimal'
                pattern='\d{1,8}(\.\d{1,2})?'
                value={form.price}
                onChange={set('price')}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-interval'>Billed</Label>
              <NativeSelect
                id='addon-interval'
                className='w-full'
                value={form.interval}
                onChange={set('interval')}
              >
                <NativeSelectOption value='month'>Every month</NativeSelectOption>
                <NativeSelectOption value='year'>Every year</NativeSelectOption>
                <NativeSelectOption value='once'>Once</NativeSelectOption>
                <NativeSelectOption value='none'>Not billed</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-unit'>Per</Label>
              <NativeSelect
                id='addon-unit'
                className='w-full'
                value={form.unit}
                onChange={set('unit')}
              >
                {Object.entries(UNIT_LABELS).map(([v, l]) => (
                  <NativeSelectOption key={v} value={v}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className='grid grid-cols-3 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-trial'>Free trial days</Label>
              <Input
                id='addon-trial'
                type='number'
                min={0}
                max={90}
                required
                value={form.trial_days}
                onChange={set('trial_days')}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-status'>Status</Label>
              <NativeSelect
                id='addon-status'
                className='w-full'
                value={form.status}
                onChange={set('status')}
              >
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <NativeSelectOption key={v} value={v}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-order'>Order</Label>
              <Input
                id='addon-order'
                type='number'
                min={0}
                max={10000}
                required
                value={form.sort_order}
                onChange={set('sort_order')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={busy}>
              {busy ? 'Saving…' : addon ? 'Save add-on' : 'Add add-on'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddonsScreen() {
  const canEdit = useCan('plans.manage');
  const { data, isPending, error } = useAddons(true);
  const [editing, setEditing] = useState<Addon | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className='flex flex-col gap-4'>
      <AddonRequestsCard />
      {canEdit && (
        <Button className='self-start' onClick={() => setAdding(true)}>
          Add add-on
        </Button>
      )}
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Add-on</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Trial</TableHead>
                <TableHead>Stores using it</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className='text-right'>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <EmptyRow colSpan={canEdit ? 7 : 6}>
                  No add-ons yet. Add one to start selling it.
                </EmptyRow>
              )}
              {data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className='font-medium'>{a.name}</div>
                    <div className='text-muted-foreground font-mono text-xs'>{a.code}</div>
                    {a.tagline && (
                      <div className='text-muted-foreground mt-1 max-w-xs text-xs'>
                        {a.tagline}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {CATEGORY_LABELS[a.category]}
                    <div className='text-muted-foreground text-xs'>
                      {ADDON_KIND_LABELS[a.kind]}
                    </div>
                  </TableCell>
                  <TableCell className='tabular-nums'>{addonPrice(a)}</TableCell>
                  <TableCell className='tabular-nums'>
                    {a.trial_days ? `${a.trial_days} days` : '—'}
                  </TableCell>
                  <TableCell className='tabular-nums'>{a.active_stores}</TableCell>
                  <TableCell>
                    <Badge
                      variant={a.status === 'live' ? 'default' : 'outline'}
                      className={a.status === 'retired' ? 'text-muted-foreground' : undefined}
                    >
                      {STATUS_LABELS[a.status]}
                    </Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell className='text-right'>
                      <Button size='sm' variant='outline' onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className='text-muted-foreground text-sm'>
        Retire an add-on to stop selling it. Stores that already have it keep it until it ends.
        Add-ons are never deleted, because stores’ licences refer to their code.
      </p>
      {adding && <AddonDialog addon={null} onClose={() => setAdding(false)} />}
      {editing && (
        <AddonDialog key={editing.id} addon={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
