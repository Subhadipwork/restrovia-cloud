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
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDay, formatMoney } from '@/lib/display';
import { type Plan, useCreatePlan, usePlans, useUpdatePlan } from './api';
import { EmptyRow, QueryState } from './ui';

const PRICE_PATTERN = '\\d{1,8}(\\.\\d{1,2})?';
const INTERVAL_LABELS = { month: 'month', year: 'year' } as const;

type FormState = {
  code: string;
  name: string;
  price: string;
  interval: 'month' | 'year';
  max_devices: string;
};

/** Add (no plan given) or edit a plan. Code and billing period can't change once a plan exists. */
function PlanDialog({
  plan,
  open,
  onClose
}: {
  plan: Plan | null;
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const [form, setForm] = useState<FormState>(() => ({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    price: plan ? String(Number(plan.price)) : '',
    interval: plan?.interval ?? 'month',
    max_devices: String(plan?.max_devices ?? 1)
  }));
  const set =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const busy = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const done = {
      onSuccess: () => {
        toast.success(plan ? 'Plan saved' : 'Plan added');
        onClose();
      },
      onError: (err: unknown) => toast.error(errorMessage(err))
    };
    if (plan) {
      update.mutate(
        {
          id: plan.id,
          changes: { name: form.name, price: form.price, max_devices: Number(form.max_devices) }
        },
        done
      );
    } else {
      create.mutate(
        {
          code: form.code,
          name: form.name,
          price: form.price,
          interval: form.interval,
          max_devices: Number(form.max_devices)
        },
        done
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>{plan ? `Edit ${plan.name}` : 'Add a plan'}</DialogTitle>
            <DialogDescription>
              {plan
                ? 'A new price applies to activations and renewals from now on. Licences already paid keep their price and end date.'
                : 'The plan appears in “Activate plan” on every store as soon as it is added.'}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='plan-name'>Name customers see</Label>
            <Input
              id='plan-name'
              required
              maxLength={100}
              placeholder='Outlet monthly'
              value={form.name}
              onChange={set('name')}
            />
          </div>
          {!plan && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='plan-code'>Code</Label>
              <Input
                id='plan-code'
                required
                pattern='[a-z0-9][a-z0-9_]{1,62}'
                placeholder='outlet_monthly'
                value={form.code}
                onChange={set('code')}
              />
              <p className='text-muted-foreground text-xs'>
                Lowercase letters, digits and _. It can’t be changed later.
              </p>
            </div>
          )}
          <div className='grid grid-cols-2 gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='plan-price'>Price (₹)</Label>
              <Input
                id='plan-price'
                required
                inputMode='decimal'
                pattern={PRICE_PATTERN}
                placeholder='999'
                value={form.price}
                onChange={set('price')}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='plan-interval'>Billed every</Label>
              <NativeSelect
                id='plan-interval'
                className='w-full'
                value={form.interval}
                disabled={!!plan}
                onChange={set('interval')}
              >
                <NativeSelectOption value='month'>Month</NativeSelectOption>
                <NativeSelectOption value='year'>Year</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='plan-devices'>POS computers per store</Label>
            <Input
              id='plan-devices'
              type='number'
              min={1}
              max={100}
              required
              value={form.max_devices}
              onChange={set('max_devices')}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={busy}>
              {busy ? 'Saving…' : plan ? 'Save plan' : 'Add plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PlansScreen() {
  const canEdit = useCan('plans.manage');
  const { data, isPending, error } = usePlans(true);
  const update = useUpdatePlan();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [adding, setAdding] = useState(false);

  const toggle = (p: Plan) =>
    update.mutate(
      { id: p.id, changes: { is_active: !p.is_active } },
      {
        onSuccess: () =>
          toast.success(
            p.is_active ? `${p.name} is no longer on sale` : `${p.name} is on sale again`
          ),
        onError: (err) => toast.error(errorMessage(err))
      }
    );

  return (
    <div className='flex flex-col gap-4'>
      {canEdit && (
        <Button className='self-start' onClick={() => setAdding(true)}>
          Add plan
        </Button>
      )}
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>POS computers</TableHead>
                <TableHead>Stores on it</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className='text-right'>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <EmptyRow colSpan={canEdit ? 6 : 5}>
                  No plans yet. Add one so stores can be activated.
                </EmptyRow>
              )}
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className='font-medium'>{p.name}</div>
                    <div className='text-muted-foreground font-mono text-xs'>{p.code}</div>
                  </TableCell>
                  <TableCell className='tabular-nums'>
                    {formatMoney(p.price, p.currency)}
                    <span className='text-muted-foreground'> / {INTERVAL_LABELS[p.interval]}</span>
                  </TableCell>
                  <TableCell className='tabular-nums'>{p.max_devices}</TableCell>
                  <TableCell className='tabular-nums'>{p.active_stores}</TableCell>
                  <TableCell>
                    {p.is_active ? (
                      <Badge>On sale</Badge>
                    ) : (
                      <Badge variant='outline'>Turned off</Badge>
                    )}
                    <div className='text-muted-foreground mt-1 text-xs'>
                      since {formatDay(p.created_at)}
                    </div>
                  </TableCell>
                  {canEdit && (
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-2'>
                        <Button size='sm' variant='outline' onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                        <Button
                          size='sm'
                          variant={p.is_active ? 'destructive' : 'outline'}
                          disabled={update.isPending}
                          onClick={() => toggle(p)}
                        >
                          {p.is_active ? 'Turn off' : 'Turn on'}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className='text-muted-foreground text-sm'>
        A turned-off plan can’t be chosen for new activations. Stores already on it keep it until
        their paid period ends.
      </p>
      {adding && <PlanDialog plan={null} open onClose={() => setAdding(false)} />}
      {editing && (
        <PlanDialog key={editing.id} plan={editing} open onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
