'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { AddCafeDialog } from './add-cafe';
import { useStores, type StoreSummary } from './api';
import { rememberStore } from './last-store';
import { OnlineDot, onlineText } from './store-switcher';

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
      <h2 className='text-lg font-semibold'>{title}</h2>
      <div className='text-muted-foreground max-w-sm text-sm'>{children}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className='flex flex-col gap-4 p-4 md:px-6' role='status' aria-label='Loading'>
      <Skeleton className='h-8 w-48' />
      <Skeleton className='h-32 w-full' />
    </div>
  );
}

/** Café pages render only for a café the owner is linked to; the portal reopens it next time. */
export function StoreGate({ storeId, children }: { storeId: string; children: React.ReactNode }) {
  const { data: stores, error, isPending } = useStores();
  const store = stores?.find((s) => s.id === storeId);

  useEffect(() => {
    if (store) rememberStore(store.id);
  }, [store]);

  if (isPending) return <Loading />;
  if (error) return <Message title='Can’t load your cafés'>{errorMessage(error)}</Message>;
  if (!store) {
    return (
      <Message title='Café not found'>
        This café isn’t linked to your account.{' '}
        <Link href='/dashboard/overview' className='text-foreground underline underline-offset-4'>
          Open your cafés
        </Link>
      </Message>
    );
  }
  return <>{children}</>;
}

/** /dashboard/overview: All outlets with two or more cafés; otherwise the café itself. */
export function OpenStore() {
  const router = useRouter();
  const { data: stores, error, isPending } = useStores();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!stores?.length) return;
    if (stores.length > 1) {
      router.replace('/dashboard/outlets');
      return;
    }
    router.replace(`/dashboard/${stores[0].id}`);
  }, [stores, router]);

  if (isPending || stores?.length) return <Loading />;
  if (error) return <Message title='Can’t load your cafés'>{errorMessage(error)}</Message>;
  return (
    <Message title='Your café isn’t linked yet'>
      <div className='flex flex-col items-center gap-3'>
        <p>
          Link it with the code from Restrovia POS on the café’s computer, or ask Restrovia support
          to link it for you.
        </p>
        <Button onClick={() => setAdding(true)}>Add a café with a code</Button>
      </div>
      <AddCafeDialog open={adding} onOpenChange={setAdding} />
    </Message>
  );
}

/** "POS online" or "POS offline · seen 2 h ago", linking to the POS status page. */
export function StoreStatusBadge({ storeId }: { storeId: string }) {
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  if (!store) return null;
  return (
    <Button
      variant='outline'
      size='sm'
      nativeButton={false}
      render={<Link href={`/dashboard/${storeId}/status`} aria-label={onlineText(store)} />}
      title={
        store.last_seen_at
          ? `Last seen ${formatDateTime(store.last_seen_at, store.timezone)}`
          : undefined
      }
    >
      <OnlineDot online={store.online} />
      {onlineText(store)}
    </Button>
  );
}

/** Shown on café pages when the POS is offline, so the owner knows how old the numbers are. */
export function OfflineBanner({ store, className }: { store: StoreSummary; className?: string }) {
  if (store.online) return null;
  return (
    <div
      role='status'
      className={cn(
        'border-amber-500/40 bg-amber-500/10 text-foreground flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        className
      )}
    >
      <Badge variant='outline'>Offline</Badge>
      {store.last_seen_at
        ? `The POS was last seen ${timeAgo(store.last_seen_at)} (${formatDateTime(store.last_seen_at, store.timezone)}). Numbers here are from the last sync.`
        : 'The POS hasn’t connected to Restrovia Cloud yet. Turn on Cloud Sync in POS Settings.'}
    </div>
  );
}
