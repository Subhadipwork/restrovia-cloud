'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/display';
import { useStoreStatus } from './api';
import { OnlineDot } from './store-switcher';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='text-sm'>{children}</dd>
    </div>
  );
}

const PLATFORMS: Record<string, string> = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };

export function StatusScreen({ storeId }: { storeId: string }) {
  const { data, error, isPending } = useStoreStatus(storeId);
  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) return <Skeleton className='h-48' role='status' aria-label='Loading' />;
  const when = (v: string | null) =>
    v ? `${timeAgo(v)} · ${formatDateTime(v, data.timezone)}` : 'never';

  return (
    <div className='flex max-w-3xl flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <OnlineDot online={data.online} className='size-3' />
            {data.online ? 'Your POS is online' : 'Your POS is offline'}
          </CardTitle>
          <CardDescription>
            {data.online
              ? 'Sales and orders reach this portal within a minute.'
              : data.last_seen_at
                ? 'The café computer may be off, or its internet may be down. Billing keeps working on the POS; the numbers here catch up when it reconnects.'
                : 'The POS hasn’t connected to Restrovia Cloud yet. Turn on Cloud Sync in POS Settings → Cloud.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-3 sm:grid-cols-2'>
            <Field label='Last seen'>{when(data.last_seen_at)}</Field>
            <Field label='Last order synced'>{when(data.last_order_synced_at)}</Field>
          </dl>
        </CardContent>
      </Card>

      <h2 className='text-base font-semibold'>
        POS computers {data.devices.length > 0 && `(${data.devices.length})`}
      </h2>
      {data.devices.length === 0 && (
        <p className='text-muted-foreground text-sm'>No POS computer is connected to this café.</p>
      )}
      <div className='grid gap-3 sm:grid-cols-2'>
        {data.devices.map((d) => (
          <Card key={d.id} className='gap-3 py-4'>
            <CardHeader className='px-4'>
              <div className='flex items-center justify-between gap-2'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <OnlineDot online={d.online} />
                  {d.name || 'POS computer'}
                </CardTitle>
                <Badge variant={d.online ? 'default' : 'outline'}>
                  {d.online ? 'Online' : 'Offline'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className='px-4'>
              <dl className='grid grid-cols-2 gap-3'>
                <Field label='Last seen'>
                  {d.last_seen_at ? timeAgo(d.last_seen_at) : 'never'}
                </Field>
                <Field label='Instant updates'>
                  {d.live_connection ? 'Connected' : d.online ? 'Every 10 seconds' : '—'}
                </Field>
                <Field label='Restrovia POS'>{d.app_version ? `v${d.app_version}` : '—'}</Field>
                <Field label='Computer'>{PLATFORMS[d.platform ?? ''] ?? d.platform ?? '—'}</Field>
                <Field label='Open orders'>{d.open_orders}</Field>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        A POS counts as online when it has checked in during the last 10 minutes.
      </p>
    </div>
  );
}
