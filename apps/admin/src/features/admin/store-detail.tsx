'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
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
import {
  formatDateTime,
  formatDay,
  formatMoney,
  LICENCE_LABELS,
  licenceTone,
  TICKET_LABELS,
  storeCode,
  timeAgo
} from '@/lib/display';
import {
  type LicenceAction,
  type StoreDetail,
  useChangeLicence,
  usePlans,
  useResetBinding,
  useStore
} from './api';
import {
  ActivityCard,
  BackupsCard,
  LocationCard,
  OnlineHistoryCard,
  StoreAccess
} from './store-history';
import { ValueBarChart } from '@/components/value-bar-chart';
import { shortDay } from '@/lib/ist-dates';
import { StoreOwnersCard } from './store-owners';
import { EmptyRow, QueryState } from './ui';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='text-sm break-words'>{children || '—'}</dd>
    </div>
  );
}

type DialogKind = 'extend_trial' | 'activate' | 'suspend' | 'stop_now' | null;

function LicenceDialog({
  storeId,
  kind,
  onClose
}: {
  storeId: string;
  kind: DialogKind;
  onClose: () => void;
}) {
  const plans = usePlans();
  const change = useChangeLicence(storeId);
  const [days, setDays] = useState('15');
  const [planCode, setPlanCode] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const plan = plans.data?.find((p) => p.code === planCode) ?? plans.data?.[0];
  const titles = {
    extend_trial: 'Extend trial',
    activate: 'Activate a plan',
    suspend: 'Suspend licence',
    stop_now: 'Stop billing now'
  };
  const stopsBilling = kind === 'suspend' || kind === 'stop_now';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let body: LicenceAction;
    if (kind === 'extend_trial')
      body = { action: 'extend_trial', days: Number(days), ...(note && { note }) };
    else if (kind === 'activate')
      body = {
        action: 'activate',
        plan_code: plan!.code,
        ...(amount && { amount }),
        ...(note && { note })
      };
    else
      body = {
        action: 'suspend',
        ...(kind === 'stop_now' && { immediate: true }),
        ...(note && { note })
      };
    change.mutate(body, {
      onSuccess: () => {
        toast.success(
          kind === 'stop_now'
            ? 'Billing stopped'
            : kind === 'suspend'
              ? 'Licence suspended'
              : kind === 'activate'
                ? 'Plan activated'
                : 'Trial extended'
        );
        onClose();
      },
      onError: (err) => toast.error(errorMessage(err))
    });
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {kind && (
          <form onSubmit={submit} className='flex flex-col gap-4'>
            <DialogHeader>
              <DialogTitle>{titles[kind]}</DialogTitle>
              <DialogDescription>
                {kind === 'stop_now'
                  ? 'The POS stops taking new orders as soon as it hears from the cloud, usually within a minute. There is no grace period. A POS that is offline keeps billing until it reconnects or its 5-day check-in limit runs out.'
                  : kind === 'suspend'
                    ? 'Cloud orders and reports stop at the next heartbeat. The POS keeps billing for 24 hours, then stops taking new orders.'
                    : 'The POS picks up the change within a minute when it is online.'}
              </DialogDescription>
            </DialogHeader>
            {kind === 'extend_trial' && (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='days'>Extra days (1–90)</Label>
                <Input
                  id='days'
                  type='number'
                  min={1}
                  max={90}
                  required
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            )}
            {kind === 'activate' && (
              <>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='plan'>Plan</Label>
                  <NativeSelect
                    id='plan'
                    className='w-full'
                    value={plan?.code ?? ''}
                    onChange={(e) => setPlanCode(e.target.value)}
                  >
                    {plans.data?.map((p) => (
                      <NativeSelectOption key={p.code} value={p.code}>
                        {p.name} — {formatMoney(p.price, p.currency)} / {p.interval}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='amount'>Payment received (optional)</Label>
                  <Input
                    id='amount'
                    inputMode='decimal'
                    placeholder={plan?.price}
                    pattern='\d{1,8}(\.\d{1,2})?'
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className='flex flex-col gap-2'>
              <Label htmlFor='note'>Note (optional)</Label>
              <Textarea
                id='note'
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder='For example: paid by UPI, ref 1234'
              />
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Cancel
              </Button>
              <Button
                type='submit'
                variant={stopsBilling ? 'destructive' : 'default'}
                disabled={change.isPending || (kind === 'activate' && !plan)}
              >
                {change.isPending ? 'Saving…' : titles[kind]}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LicenceCard({ data }: { data: StoreDetail }) {
  const canChange = useCan('stores.licence');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const current = data.licence_history.find((l) =>
    ['trial', 'active', 'past_due'].includes(l.status)
  );
  const latest = data.licence_history[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between gap-2 text-base'>
          Licence
          <Badge variant={licenceTone(latest?.status)}>
            {LICENCE_LABELS[latest?.status ?? 'none']}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {latest && (
          <dl className='grid grid-cols-2 gap-3'>
            <Field label='Plan'>
              {latest.plan_name ?? (latest.status === 'trial' ? 'Free trial' : '')}
            </Field>
            <Field label={latest.status === 'trial' ? 'Trial ends' : 'Paid until'}>
              {formatDay(
                latest.status === 'trial' ? latest.trial_ends_at : latest.current_period_end
              )}
            </Field>
          </dl>
        )}
        {canChange && (
          <div className='flex flex-wrap gap-2'>
            {(!current || current.status === 'trial') && (
              <Button size='sm' variant='outline' onClick={() => setDialog('extend_trial')}>
                Extend trial
              </Button>
            )}
            <Button size='sm' onClick={() => setDialog('activate')}>
              {current?.status === 'active' ? 'Renew' : 'Activate plan'}
            </Button>
            {current && (
              <Button size='sm' variant='destructive' onClick={() => setDialog('suspend')}>
                Suspend
              </Button>
            )}
            {(current || (latest?.status === 'suspended' && !latest.grace_waived)) && (
              <Button size='sm' variant='destructive' onClick={() => setDialog('stop_now')}>
                Stop billing now
              </Button>
            )}
          </div>
        )}
        <div>
          <h3 className='mb-2 text-sm font-medium'>History</h3>
          <ul className='flex flex-col gap-1 text-sm'>
            {data.licence_history.map((l) => (
              <li key={l.id} className='flex flex-wrap justify-between gap-2'>
                <span>
                  <Badge variant={licenceTone(l.status)} className='mr-2'>
                    {LICENCE_LABELS[l.status]}
                  </Badge>
                  {l.plan_name ?? 'Trial'}
                  {l.grace_waived && <span className='text-muted-foreground'> · stopped at once</span>}
                  {l.notes && <span className='text-muted-foreground'> · {l.notes}</span>}
                </span>
                <span className='text-muted-foreground'>{formatDay(l.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
        {data.payments.length > 0 && (
          <div>
            <h3 className='mb-2 text-sm font-medium'>Payments</h3>
            <ul className='flex flex-col gap-1 text-sm'>
              {data.payments.map((p) => (
                <li key={p.id} className='flex justify-between'>
                  <span>
                    {formatMoney(p.amount, p.currency)} · {p.method}
                  </span>
                  <span className='text-muted-foreground'>{formatDay(p.paid_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <LicenceDialog storeId={data.store.id} kind={dialog} onClose={() => setDialog(null)} />
    </Card>
  );
}

export function StoreDetailScreen({ id }: { id: string }) {
  const { data, isPending, error } = useStore(id);
  const seesTickets = useCan('tickets.view');
  const canResetBinding = useCan('stores.devices');
  const resetBinding = useResetBinding(id);
  const [resetConfirm, setResetConfirm] = useState<string | null>(null);
  if (!data) return <QueryState isPending={isPending} error={error} rows={6} />;
  const { store } = data;
  const currency = store.currency ?? 'INR';

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-xl font-semibold'>
          {store.name || 'Unnamed store'}
          {store.status !== 'active' && (
            <Badge variant='destructive' className='ml-2 align-middle'>
              {store.status === 'suspended' ? 'Blocked' : store.status}
            </Badge>
          )}
        </h2>
        <Link
          href={`/dashboard/stores/${id}/history`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          History and charts
        </Link>
      </div>
      <StoreAccess data={data} />
      <div className='grid gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle className='text-base'>Store</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className='grid grid-cols-2 gap-3 md:grid-cols-3'>
              <Field label='Contact'>{store.contactName}</Field>
              <Field label='Phone'>{store.phone}</Field>
              <Field label='Email'>{store.email}</Field>
              <Field label='Type'>{store.storeType}</Field>
              <Field label='Currency'>{store.currency}</Field>
              <Field label='Business day starts'>{store.businessDayStart.slice(0, 5)}</Field>
              <Field label='Joined'>{formatDay(store.createdAt)}</Field>
              <Field label='Details updated'>{formatDateTime(store.updatedAt)}</Field>
              <Field label='Store code'>
                <span className='font-mono text-base font-semibold tracking-widest'>
                  {storeCode(store.id)}
                </span>
              </Field>
              <Field label='Store ID'>
                <span className='font-mono text-xs'>{store.id}</span>
              </Field>
            </dl>
          </CardContent>
        </Card>
        <LicenceCard data={data} />
      </div>

      <div className='grid gap-4 lg:grid-cols-3'>
      <LocationCard data={data} />
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle className='text-base'>Sales, last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          {data.stats.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No synced sales yet.</p>
          ) : (
            <ValueBarChart
              seriesLabel='Sales'
              formatValue={(n) => formatMoney(n, currency)}
              rows={data.stats.map((s) => ({
                label: shortDay(s.business_date),
                value: Number(s.gross_sales),
                detail: `${formatMoney(s.gross_sales, currency)} · ${s.bills_count} bills`
              }))}
            />
          )}
        </CardContent>
      </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>POS devices</CardTitle>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Open orders</TableHead>
                <TableHead>Licence check</TableHead>
                <TableHead>Registered</TableHead>
                {canResetBinding && <TableHead className='text-right'>Computer</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.devices.length === 0 && (
                <EmptyRow colSpan={canResetBinding ? 7 : 6}>No devices.</EmptyRow>
              )}
              {data.devices.map((d) => {
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      {d.device_name ?? 'Unnamed'}{' '}
                      <span className='text-muted-foreground text-xs'>{d.platform}</span>
                    </TableCell>
                    <TableCell>
                      {d.revoked_at ? (
                        <Badge variant='destructive'>Revoked</Badge>
                      ) : (
                        <span
                          className='flex items-center gap-2 text-sm'
                          title={d.last_seen_at ? `Last seen ${formatDateTime(d.last_seen_at)}` : undefined}
                        >
                          {d.online && <Badge>Online</Badge>}
                          Seen {timeAgo(d.last_seen_at)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{d.app_version ?? '—'}</TableCell>
                    <TableCell className='tabular-nums'>{d.active_orders}</TableCell>
                    <TableCell className='text-sm'>
                      {d.last_licence_at ? timeAgo(d.last_licence_at) : 'never'}
                    </TableCell>
                    <TableCell className='text-sm'>{formatDateTime(d.created_at)}</TableCell>
                    {canResetBinding && (
                      <TableCell className='text-right'>
                        {d.machine_bound ? (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={resetBinding.isPending}
                            onClick={() => {
                              if (resetConfirm !== d.id) return setResetConfirm(d.id);
                              resetBinding.mutate(d.id, {
                                onSuccess: () => {
                                  setResetConfirm(null);
                                  toast.success(
                                    'Binding reset. The POS can now check in from its new computer.'
                                  );
                                },
                                onError: (err) => toast.error(errorMessage(err))
                              });
                            }}
                          >
                            {resetConfirm === d.id ? 'Confirm reset' : 'Reset binding'}
                          </Button>
                        ) : (
                          <span className='text-muted-foreground text-xs'>Not bound yet</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OnlineHistoryCard data={data} />
      <BackupsCard data={data} />

      <div className='grid gap-4 md:grid-cols-2'>
        <StoreOwnersCard data={data} />
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Recent support tickets</CardTitle>
          </CardHeader>
          <CardContent>
            {data.tickets.length === 0 ? (
              <p className='text-muted-foreground text-sm'>No tickets from this store.</p>
            ) : (
              <ul className='flex flex-col gap-2 text-sm'>
                {data.tickets.map((t) => (
                  <li key={t.id} className='flex justify-between gap-2'>
                    {seesTickets ? (
                      <Link
                        href={`/dashboard/tickets/${t.id}`}
                        className='truncate hover:underline'
                      >
                        {t.message.split('\n')[0] || t.support_code}
                      </Link>
                    ) : (
                      <span className='truncate'>{t.message.split('\n')[0] || t.support_code}</span>
                    )}
                    <Badge variant='outline'>{TICKET_LABELS[t.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ActivityCard data={data} />
    </div>
  );
}
