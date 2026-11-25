'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { errorMessage, ownerApi } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/display';

type Addon = {
  code: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  kind: string;
  price: string;
  currency: string;
  interval: 'month' | 'year' | 'once' | 'none';
  unit: string;
  trial_days: number;
  status: 'live' | 'beta';
  is_featured: boolean;
  state: 'in_plan' | 'active' | 'trial' | 'available';
  ends_at: string | null;
  can_add_free: boolean;
  can_start_trial: boolean;
  can_request: boolean;
  pending_request: { id: string; quantity: number; created_at: string } | null;
};

type MyAddon = {
  id: string;
  addon_code: string;
  addon_name: string;
  status: 'trial' | 'active' | 'cancelled';
  source: string;
  quantity: number;
  price: string;
  currency: string;
  ends_at: string | null;
  can_cancel: boolean;
  payments: { amount: string; currency: string; paid_at: string }[];
};

type AddonRequest = {
  id: string;
  addon_code: string;
  addon_name: string;
  quantity: number;
  note: string;
  status: 'pending' | 'done' | 'declined' | 'cancelled';
  requested_by: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

type Marketplace = {
  role: 'owner' | 'manager';
  addons: Addon[];
  mine: MyAddon[];
  requests: AddonRequest[];
};

const CATEGORY_LABELS: Record<string, string> = {
  channels: 'Sales channels',
  operations: 'Operations',
  money: 'Payments',
  marketing: 'Marketing',
  reports: 'Reports',
  services: 'Services'
};
const UNIT_LABELS: Record<string, string> = {
  device: 'computer',
  kiosk: 'kiosk',
  screen: 'screen',
  pack: 'pack'
};
const REQUEST_LABELS: Record<AddonRequest['status'], string> = {
  pending: 'Waiting for Restrovia',
  done: 'Added',
  declined: 'Declined',
  cancelled: 'Withdrawn'
};

const queryKey = (storeId: string) => ['owner', 'store', storeId, 'marketplace'];

const useMarketplace = (storeId: string) =>
  useQuery({
    queryKey: queryKey(storeId),
    queryFn: () => ownerApi<Marketplace>(`/stores/${storeId}/marketplace`)
  });

function price(a: Pick<Addon, 'price' | 'currency' | 'interval' | 'unit' | 'kind'>): string {
  if (a.kind === 'contact') return 'Ask Restrovia';
  if (Number(a.price) === 0) return 'Free';
  const every = a.interval === 'month' || a.interval === 'year' ? ` / ${a.interval}` : '';
  const per = UNIT_LABELS[a.unit] ? ` per ${UNIT_LABELS[a.unit]}` : '';
  return `${formatMoney(a.price, a.currency)}${every}${per}`;
}

const day = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function useAction(storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object; done: string }) =>
      ownerApi(`/stores/${storeId}/marketplace${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: async (_data, { done }) => {
      await queryClient.invalidateQueries({ queryKey: queryKey(storeId) });
      toast.success(done);
    },
    onError: (err) => toast.error(errorMessage(err))
  });
}

function RequestDialog({
  storeId,
  addon,
  onClose
}: {
  storeId: string;
  addon: Addon;
  onClose: () => void;
}) {
  const action = useAction(storeId);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const perUnit = addon.unit !== 'outlet';
  const renewing = addon.state === 'active' || addon.state === 'trial';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(
              {
                path: `/addons/${addon.code}/request`,
                body: { quantity: perUnit ? Number(quantity) : 1, note },
                done: 'Request sent. Restrovia will contact you to complete the payment.'
              },
              { onSuccess: onClose }
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {renewing ? 'Keep' : 'Get'} {addon.name}
            </DialogTitle>
            <DialogDescription>
              {price(addon)}. Restrovia will contact you to take the payment. Once it is added, the
              POS switches it on by itself within a minute.
            </DialogDescription>
          </DialogHeader>
          {perUnit && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='addon-quantity'>
                How many {UNIT_LABELS[addon.unit] ?? addon.unit}s
              </Label>
              <Input
                id='addon-quantity'
                type='number'
                min={1}
                max={100}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          )}
          <div className='flex flex-col gap-2'>
            <Label htmlFor='addon-note'>Note for Restrovia (optional)</Label>
            <Textarea
              id='addon-note'
              maxLength={500}
              placeholder='For example: a good time to call'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={action.isPending}>
              {action.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StateBadge({ addon }: { addon: Addon }) {
  if (addon.state === 'in_plan') return <Badge variant='secondary'>In your plan</Badge>;
  if (addon.state === 'active') return <Badge>Active</Badge>;
  if (addon.state === 'trial') return <Badge variant='outline'>Trial</Badge>;
  if (addon.pending_request) return <Badge variant='outline'>Requested</Badge>;
  return null;
}

function AddonCard({
  storeId,
  addon,
  isOwner,
  onRequest,
  onDetails
}: {
  storeId: string;
  addon: Addon;
  isOwner: boolean;
  onRequest: () => void;
  onDetails: () => void;
}) {
  const action = useAction(storeId);
  const renewing = addon.state === 'active' || addon.state === 'trial';
  return (
    <Card className='flex flex-col'>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
          {addon.name}
          {addon.status === 'beta' && <Badge variant='outline'>Beta</Badge>}
          <StateBadge addon={addon} />
        </CardTitle>
        <CardDescription>{addon.tagline}</CardDescription>
      </CardHeader>
      <CardContent className='mt-auto flex flex-col gap-3'>
        <div className='text-sm'>
          <span className='font-medium'>{price(addon)}</span>
          {addon.trial_days > 0 && addon.state === 'available' && (
            <span className='text-muted-foreground'> · {addon.trial_days}-day free trial</span>
          )}
          {addon.ends_at && (
            <div className='text-muted-foreground text-xs'>
              {addon.state === 'trial' ? 'Trial ends' : 'Runs until'} {day(addon.ends_at)}
            </div>
          )}
          {addon.pending_request && (
            <div className='text-muted-foreground text-xs'>
              Requested {day(addon.pending_request.created_at)}. Restrovia will contact you.
            </div>
          )}
        </div>
        <div className='flex flex-wrap gap-2'>
          {isOwner && addon.can_add_free && (
            <Button
              size='sm'
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  path: `/addons/${addon.code}/add`,
                  body: { mode: 'free' },
                  done: `${addon.name} added. The POS switches it on within a minute.`
                })
              }
            >
              Add
            </Button>
          )}
          {isOwner && addon.can_start_trial && (
            <Button
              size='sm'
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  path: `/addons/${addon.code}/add`,
                  body: { mode: 'trial' },
                  done: `${addon.name} trial started. The POS switches it on within a minute.`
                })
              }
            >
              Start free trial
            </Button>
          )}
          {addon.can_request && (
            <Button
              size='sm'
              variant={addon.can_start_trial ? 'outline' : 'default'}
              onClick={onRequest}
            >
              {renewing ? 'Request to keep it' : 'Request to buy'}
            </Button>
          )}
          <Button size='sm' variant='ghost' onClick={onDetails}>
            Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MyAddons({ storeId, mine }: { storeId: string; mine: MyAddon[] }) {
  const action = useAction(storeId);
  const [cancelling, setCancelling] = useState<MyAddon | null>(null);
  if (mine.length === 0) return null;
  const stopsNow = (m: MyAddon) => m.status === 'trial' || m.ends_at === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Your add-ons</CardTitle>
        <CardDescription>What this café has now, and what it paid.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y'>
          {mine.map((m) => (
            <li key={m.id} className='flex flex-wrap items-start justify-between gap-3 py-3'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-2 font-medium'>
                  {m.addon_name}
                  {m.quantity > 1 && <span className='text-muted-foreground'>× {m.quantity}</span>}
                  <Badge variant={m.status === 'active' ? 'default' : 'outline'}>
                    {m.status === 'trial'
                      ? 'Trial'
                      : m.status === 'cancelled'
                        ? 'Cancelled'
                        : 'Active'}
                  </Badge>
                </div>
                <div className='text-muted-foreground text-xs'>
                  {m.ends_at
                    ? `${m.status === 'cancelled' ? 'Stops' : m.status === 'trial' ? 'Trial ends' : 'Renew by'} ${day(m.ends_at)}`
                    : 'No end date'}
                  {m.source === 'grandfathered' && ' · Kept free because you used it before'}
                </div>
                {m.payments.length > 0 && (
                  <div className='text-muted-foreground mt-1 text-xs'>
                    Paid:{' '}
                    {m.payments
                      .map((p) => `${formatMoney(p.amount, p.currency)} on ${day(p.paid_at)}`)
                      .join(', ')}
                  </div>
                )}
              </div>
              {m.can_cancel && (
                <Button size='sm' variant='ghost' onClick={() => setCancelling(m)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      <AlertDialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {cancelling?.addon_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling && stopsNow(cancelling)
                ? 'It stops on the POS within a minute. Its data stays on the POS.'
                : `It keeps working until ${cancelling?.ends_at ? day(cancelling.ends_at) : ''}, then stops. Its data stays on the POS.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                cancelling &&
                action.mutate({
                  path: `/mine/${cancelling.id}/cancel`,
                  done: `${cancelling.addon_name} cancelled.`
                })
              }
            >
              Cancel add-on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Requests({ storeId, requests }: { storeId: string; requests: AddonRequest[] }) {
  const action = useAction(storeId);
  if (requests.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Requests</CardTitle>
        <CardDescription>Add-ons you asked Restrovia for.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y'>
          {requests.map((r) => (
            <li key={r.id} className='flex flex-wrap items-start justify-between gap-3 py-3'>
              <div className='min-w-0'>
                <div className='flex flex-wrap items-center gap-2 font-medium'>
                  {r.addon_name}
                  {r.quantity > 1 && <span className='text-muted-foreground'>× {r.quantity}</span>}
                  <Badge variant={r.status === 'pending' ? 'outline' : 'secondary'}>
                    {REQUEST_LABELS[r.status]}
                  </Badge>
                </div>
                <div className='text-muted-foreground text-xs'>
                  {formatDateTime(r.created_at)}
                  {r.requested_by && ` · ${r.requested_by}`}
                  {r.note && ` · “${r.note}”`}
                </div>
                {r.resolution_note && (
                  <div className='text-muted-foreground text-xs'>
                    Restrovia: {r.resolution_note}
                  </div>
                )}
              </div>
              {r.status === 'pending' && (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ path: `/requests/${r.id}/cancel`, done: 'Request withdrawn.' })
                  }
                >
                  Withdraw
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The café's Marketplace: add-ons to add, try or request, and the ones it has. */
export function MarketplaceScreen({ storeId }: { storeId: string }) {
  const { data, isPending, error } = useMarketplace(storeId);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [requesting, setRequesting] = useState<Addon | null>(null);
  const [details, setDetails] = useState<Addon | null>(null);

  const categories = useMemo(
    () => [...new Set((data?.addons ?? []).map((a) => a.category))],
    [data?.addons]
  );
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (data?.addons ?? [])
      .filter((a) => category === 'all' || a.category === category)
      .filter(
        (a) => !words || `${a.name} ${a.tagline} ${a.description}`.toLowerCase().includes(words)
      )
      .toSorted((a, b) => Number(b.is_featured) - Number(a.is_featured));
  }, [data?.addons, search, category]);

  if (isPending) {
    return (
      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className='h-44' />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  }
  const isOwner = data.role === 'owner';

  return (
    <div className='flex flex-col gap-6'>
      {!isOwner && (
        <p className='text-muted-foreground rounded-lg border p-3 text-sm'>
          Only the café’s owners can add add-ons or start trials. You can request paid add-ons, and
          Restrovia will contact the café.
        </p>
      )}
      <MyAddons storeId={storeId} mine={data.mine} />
      <Requests storeId={storeId} requests={data.requests} />

      <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
        <Input
          aria-label='Search add-ons'
          placeholder='Search add-ons'
          className='sm:max-w-xs'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {categories.length > 1 && (
          <ToggleGroup
            variant='outline'
            size='sm'
            value={[category]}
            onValueChange={(v) => setCategory(v[0] ?? 'all')}
            className='flex-wrap'
          >
            <ToggleGroupItem value='all'>All</ToggleGroupItem>
            {categories.map((c) => (
              <ToggleGroupItem key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {shown.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No add-ons match.</p>
      ) : (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {shown.map((a) => (
            <AddonCard
              key={a.code}
              storeId={storeId}
              addon={a}
              isOwner={isOwner}
              onRequest={() => setRequesting(a)}
              onDetails={() => setDetails(a)}
            />
          ))}
        </div>
      )}

      {requesting && (
        <RequestDialog storeId={storeId} addon={requesting} onClose={() => setRequesting(null)} />
      )}
      <Dialog open={!!details} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{details?.name}</DialogTitle>
            <DialogDescription>{details && price(details)}</DialogDescription>
          </DialogHeader>
          <p className='text-sm whitespace-pre-line'>{details?.description || details?.tagline}</p>
          {details && details.trial_days > 0 && (
            <p className='text-muted-foreground text-sm'>
              {details.trial_days}-day free trial, once per café.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
