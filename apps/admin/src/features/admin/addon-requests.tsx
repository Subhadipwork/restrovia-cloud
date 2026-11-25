'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/display';
import { addonPrice } from './addons';
import { type AddonRequest, useAddonRequests, useDeclineAddonRequest } from './api';
import { QueryState } from './ui';

function DeclineDialog({ request, onClose }: { request: AddonRequest; onClose: () => void }) {
  const decline = useDeclineAddonRequest();
  const [note, setNote] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            decline.mutate(
              { storeId: request.store_id, id: request.id, note: note.trim() },
              {
                onSuccess: () => {
                  toast.success('Request declined. The owner gets an email.');
                  onClose();
                },
                onError: (err) => toast.error(errorMessage(err))
              }
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Decline {request.addon_name}</DialogTitle>
            <DialogDescription>
              {request.store_name} sees this note in the Marketplace and by email.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='decline-note'>Note for the café</Label>
            <Textarea
              id='decline-note'
              required
              minLength={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={decline.isPending}>
              {decline.isPending ? 'Saving…' : 'Decline'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({
  request,
  showStore,
  onDecline
}: {
  request: AddonRequest;
  showStore: boolean;
  onDecline?: () => void;
}) {
  return (
    <li className='flex flex-wrap items-start justify-between gap-2'>
      <div className='min-w-0'>
        <div className='font-medium'>
          {request.addon_name}
          {request.quantity > 1 && (
            <span className='text-muted-foreground'> × {request.quantity}</span>
          )}
          {showStore && (
            <>
              {' · '}
              <Link className='underline' href={`/dashboard/stores/${request.store_id}`}>
                {request.store_name || request.store_code}
              </Link>
            </>
          )}
        </div>
        <div className='text-muted-foreground text-xs'>
          {addonPrice(request)} · {formatDateTime(request.created_at)}
          {request.requested_by && ` · ${request.requested_by}`}
        </div>
        {request.note && <div className='text-muted-foreground text-xs'>“{request.note}”</div>}
      </div>
      {onDecline && (
        <Button size='sm' variant='ghost' onClick={onDecline}>
          Decline
        </Button>
      )}
    </li>
  );
}

/**
 * Cafés' pending requests to buy paid add-ons. Adding the add-on on the store page, with the payment,
 * closes the request and tells the owner; Decline closes it with a note.
 */
export function AddonRequestsCard({ storeId }: { storeId?: string }) {
  const canView = useCan('stores.view');
  const canChange = useCan('stores.licence');
  const { data, isPending, error } = useAddonRequests(storeId, canView);
  const [declining, setDeclining] = useState<AddonRequest | null>(null);
  if (!canView || (storeId && data?.length === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>
          {storeId ? 'Requested by the café' : 'Requests from cafés'}
        </CardTitle>
        <CardDescription>
          Take the payment, then add the add-on {storeId ? 'below' : 'on the store page'} with the
          amount. That closes the request and emails the owner.
        </CardDescription>
      </CardHeader>
      <CardContent className='text-sm'>
        {!data ? (
          <QueryState isPending={isPending} error={error} />
        ) : data.length === 0 ? (
          <p className='text-muted-foreground'>No requests waiting.</p>
        ) : (
          <ul className='flex flex-col gap-3'>
            {data.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                showStore={!storeId}
                onDecline={canChange ? () => setDeclining(r) : undefined}
              />
            ))}
          </ul>
        )}
      </CardContent>
      {declining && <DeclineDialog request={declining} onClose={() => setDeclining(null)} />}
    </Card>
  );
}
