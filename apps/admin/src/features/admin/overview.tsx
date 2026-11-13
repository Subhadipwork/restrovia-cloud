'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/features/auth/use-admin';
import { LICENCE_LABELS, licenceTone } from '@/lib/display';
import { useLeadSummary } from '@/features/leads/api';
import { useOverview } from './api';
import { QueryState, StatCard } from './ui';

export function OverviewScreen() {
  const { data, isPending, error } = useOverview();
  const seesTickets = useCan('tickets.view');
  const sells = useCan('leads.edit');
  const seesLeads = useCan('leads.view');
  const leads = useLeadSummary(seesLeads);
  if (!data) return <QueryState isPending={isPending} error={error} rows={4} />;

  const totalStores = Object.entries(data.stores)
    .filter(([status]) => status !== 'deleted')
    .reduce((sum, [, n]) => sum + n, 0);
  const licences = Object.entries(data.licences).sort((a, b) => b[1] - a[1]);

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard
          label='Stores'
          value={totalStores}
          hint={`${data.stores.suspended ?? 0} suspended`}
        />
        <StatCard
          label='Online now'
          value={data.online_now}
          hint='POS seen in the last 10 minutes'
        />
        <StatCard label='New this month' value={data.new_this_month} />
        <StatCard
          label='Open support tickets'
          value={
            seesTickets ? (
              <Link href='/dashboard/tickets?status=open' className='hover:underline'>
                {data.open_tickets}
              </Link>
            ) : (
              data.open_tickets
            )
          }
        />
      </div>
      {leads.data && (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle className='text-base'>Leads</CardTitle>
            <Link href='/dashboard/leads' className='text-muted-foreground text-sm hover:underline'>
              Open leads list
            </Link>
          </CardHeader>
          <CardContent className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            <LeadStat label='Open' value={leads.data.open} href='/dashboard/leads' />
            <LeadStat
              label='New this week'
              value={leads.data.new_this_week}
              href='/dashboard/leads?stage='
            />
            <LeadStat
              label='Overdue follow-ups'
              value={leads.data.overdue}
              href={sells ? '/dashboard/leads/tasks' : '/dashboard/leads?follow_up=overdue&stage='}
              danger={leads.data.overdue > 0}
            />
            <LeadStat
              label='Won this month'
              value={leads.data.won_this_month}
              href='/dashboard/leads?stage=won'
            />
          </CardContent>
        </Card>
      )}
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Licences</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            {licences.length === 0 && (
              <p className='text-muted-foreground text-sm'>No stores yet.</p>
            )}
            {licences.map(([status, n]) => (
              <Link
                key={status}
                href={`/dashboard/stores?licence=${status}`}
                className='hover:bg-muted flex items-center justify-between rounded-md px-2 py-1.5'
              >
                <Badge variant={licenceTone(status)}>{LICENCE_LABELS[status] ?? status}</Badge>
                <span className='tabular-nums'>{n}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>POS versions in use</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            {data.versions.length === 0 && (
              <p className='text-muted-foreground text-sm'>No POS has connected yet.</p>
            )}
            {data.versions.map((v) => (
              <div
                key={v.version}
                className='flex items-center justify-between px-2 py-1.5 text-sm'
              >
                <span className='font-mono'>{v.version}</span>
                <span className='tabular-nums'>{v.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LeadStat({
  label,
  value,
  href,
  danger
}: {
  label: string;
  value: number;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link href={href} className='hover:bg-muted rounded-lg p-2'>
      <div className='text-muted-foreground text-sm'>{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${danger ? 'text-destructive' : ''}`}>
        {value}
      </div>
    </Link>
  );
}
