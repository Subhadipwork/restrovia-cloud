'use client';

import { IconCopy } from '@tabler/icons-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/display';
import { useStoreDetails } from './api';
import { OnlineDot } from './store-switcher';

const LICENCE: Record<string, { label: string; tone: 'default' | 'secondary' | 'destructive' }> = {
  trial: { label: 'Free trial', tone: 'secondary' },
  active: { label: 'Active', tone: 'default' },
  inactive: { label: 'Ended', tone: 'destructive' }
};
const STORE_TYPES: Record<string, string> = {
  cafe: 'Café',
  restaurant: 'Restaurant',
  qsr: 'Quick service',
  bakery: 'Bakery',
  bar: 'Bar'
};
const PLATFORMS: Record<string, string> = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };

const countryName = (code: string | null) => {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(['en-IN'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error('Couldn’t copy. Select it and copy by hand.');
  }
}

function Field({
  label,
  value,
  copyAs,
  mono
}: {
  label: string;
  value: string | null | undefined;
  copyAs?: string;
  mono?: boolean;
}) {
  return (
    <div className='flex items-start justify-between gap-3 py-2'>
      <div className='min-w-0'>
        <dt className='text-muted-foreground text-xs'>{label}</dt>
        <dd className={mono ? 'font-mono text-sm break-all select-all' : 'text-sm break-words'}>
          {value || '—'}
        </dd>
      </div>
      {copyAs && value && (
        <Button
          variant='ghost'
          size='icon'
          aria-label={`Copy ${copyAs}`}
          onClick={() => copy(value, copyAs)}
        >
          <IconCopy className='size-4' />
        </Button>
      )}
    </div>
  );
}

export function DetailsScreen({ storeId }: { storeId: string }) {
  const { data, error, isPending } = useStoreDetails(storeId);
  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) return <Skeleton className='h-96' role='status' aria-label='Loading' />;
  const licence = LICENCE[data.licence.status] ?? LICENCE.inactive;
  const ended = data.licence.status === 'inactive';

  return (
    <div className='grid max-w-4xl gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>Café</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='divide-y'>
            <Field label='Store code' value={data.code} copyAs='Store code' mono />
            <Field label='Store ID' value={data.id} copyAs='Store ID' mono />
            <Field label='Name' value={data.name} />
            <Field label='Type' value={STORE_TYPES[data.store_type] ?? data.store_type} />
            <Field
              label='Your role'
              value={data.role === 'owner' ? 'Owner' : 'Manager (view only)'}
            />
            <Field
              label='On Restrovia Cloud since'
              value={formatDateTime(data.created_at, data.timezone)}
            />
          </dl>
          <p className='text-muted-foreground mt-2 text-xs'>
            Give the store code to Restrovia support when you call. Restrovia POS shows it in
            Settings → About.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='divide-y'>
            <Field label='Contact person' value={data.contact_name} />
            <Field label='Phone' value={data.phone} />
            <Field label='Email' value={data.email} />
            <Field label='Address' value={data.address} />
          </dl>
          <p className='text-muted-foreground mt-2 text-xs'>
            Change these in Restrovia POS Settings (the contact person is the owner’s staff name).
            Changes show here within 5 minutes while the POS is online.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Region and business day</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='divide-y'>
            <Field label='Country' value={countryName(data.country)} />
            <Field label='Currency' value={data.currency} />
            <Field label='Time zone' value={data.timezone} />
            <Field
              label='Business day starts at'
              value={`${data.business_day_start}${data.business_day_start === '00:00' ? ' (midnight)' : ''}`}
            />
          </dl>
          <p className='text-muted-foreground mt-2 text-xs'>
            Sales count on the business day they were paid, in this time zone, like the POS report.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Licence</CardTitle>
          <CardAction>
            <Badge variant={licence.tone}>{licence.label}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className='divide-y'>
            <Field
              label='Plan'
              value={
                data.licence.plan_name ?? (data.licence.status === 'trial' ? 'Free trial' : null)
              }
            />
            <Field
              label={
                ended ? 'Ended' : data.licence.status === 'trial' ? 'Trial ends' : 'Renews or ends'
              }
              value={formatDateTime(data.licence.ends_at, data.timezone)}
            />
            {ended && (
              <Field
                label='Billing on the POS stops'
                value={formatDateTime(data.licence.grace_ends_at, data.timezone)}
              />
            )}
          </dl>
          {data.store_status === 'suspended' && (
            <p className='text-destructive mt-2 text-sm'>
              This café is suspended. Contact Restrovia.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <OnlineDot online={data.online} className='size-3' />
            {data.online ? 'POS online' : 'POS offline'}
          </CardTitle>
          <CardAction>
            <Button
              variant='outline'
              size='sm'
              nativeButton={false}
              render={<Link href={`/dashboard/${storeId}/status`} aria-label='POS status' />}
            >
              POS status
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className='flex flex-col gap-3 text-sm'>
          <p className='text-muted-foreground'>
            Last seen{' '}
            {data.last_seen_at
              ? `${timeAgo(data.last_seen_at)} · ${formatDateTime(data.last_seen_at, data.timezone)}`
              : 'never'}
          </p>
          {data.devices.length > 0 && (
            <ul className='divide-y'>
              {data.devices.map((d) => (
                <li key={d.id} className='flex items-center justify-between gap-3 py-2'>
                  <span className='flex items-center gap-2'>
                    <OnlineDot online={d.online} />
                    {d.name || 'POS computer'}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {[
                      d.app_version && `v${d.app_version}`,
                      PLATFORMS[d.platform ?? ''] ?? d.platform
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
