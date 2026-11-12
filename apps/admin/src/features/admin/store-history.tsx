'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useHasRole } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import {
  ACTIVITY_LABELS,
  formatBytes,
  formatDateTime,
  formatDuration,
  timeAgo
} from '@/lib/display';
import { type StoreDetail, useChangeStoreStatus } from './api';
import { EmptyRow } from './ui';

const PERIODS_PREVIEW = 10;

const BACKUP_DESTINATIONS: Record<string, string> = {
  local: 'This computer',
  google_drive: 'Google Drive',
  other: 'Other'
};

function deviceNames(data: StoreDetail): Map<string, string> {
  return new Map(data.devices.map((d) => [d.id, d.device_name ?? 'Unnamed']));
}

function StoreStatusDialog({
  data,
  open,
  onClose
}: {
  data: StoreDetail;
  open: boolean;
  onClose: () => void;
}) {
  const blocked = data.store.status === 'suspended';
  const change = useChangeStoreStatus(data.store.id);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const recipients = data.members.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    change.mutate(
      blocked
        ? { action: 'unblock', notify_owners: notify }
        : { action: 'block', reason: reason.trim(), notify_owners: notify },
      {
        onSuccess: (res) => {
          const emailed =
            res.notified > 0
              ? ` ${res.notified} ${res.notified === 1 ? 'person was' : 'people were'} emailed.`
              : '';
          toast.success(`${blocked ? 'Block lifted.' : 'Store blocked.'}${emailed}`);
          setReason('');
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err))
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>{blocked ? 'Lift the block' : 'Block cloud access'}</DialogTitle>
            <DialogDescription>
              {blocked
                ? 'Orders, reports and the owner portal work again from the POS’s next heartbeat, within 5 minutes.'
                : 'From its next heartbeat the POS stops sending orders and reports, and the owner portal closes for this store. Billing in the café keeps working, and the POS is told the reason.'}
            </DialogDescription>
          </DialogHeader>
          {!blocked && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='block-reason'>Reason (shown to the owners and on the POS)</Label>
              <Textarea
                id='block-reason'
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder='For example: invoice INV-42 is 30 days overdue'
              />
            </div>
          )}
          <Label className='flex items-center gap-2 font-normal'>
            <Checkbox checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} />
            Email the store’s owners and managers
            <span className='text-muted-foreground'>
              ({recipients === 0 ? 'none linked' : recipients})
            </span>
          </Label>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              type='submit'
              variant={blocked ? 'default' : 'destructive'}
              disabled={change.isPending || (!blocked && reason.trim().length < 3)}
            >
              {change.isPending ? 'Saving…' : blocked ? 'Lift the block' : 'Block store'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The blocked banner, and the block / lift button for admins who may change it. */
export function StoreAccess({ data }: { data: StoreDetail }) {
  const canChange = useHasRole('super_admin', 'sales');
  const [open, setOpen] = useState(false);
  const blocked = data.store.status === 'suspended';
  if (!blocked && !canChange) return null;

  return (
    <>
      {blocked ? (
        <Alert variant='destructive'>
          <AlertTitle>Cloud access is blocked</AlertTitle>
          <AlertDescription>
            <p>
              {data.block?.reason || 'No reason given.'}
              {data.block && (
                <span className='text-muted-foreground'>
                  {' '}
                  · since {formatDateTime(data.block.blocked_at)}
                </span>
              )}
            </p>
            {canChange && (
              <Button size='sm' variant='outline' className='mt-2' onClick={() => setOpen(true)}>
                Lift the block
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <div className='flex justify-end'>
          <Button size='sm' variant='destructive' onClick={() => setOpen(true)}>
            Block store
          </Button>
        </div>
      )}
      <StoreStatusDialog data={data} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function OnlineHistoryCard({ data }: { data: StoreDetail }) {
  const [showAll, setShowAll] = useState(false);
  const names = deviceNames(data);
  const online = new Set(data.devices.filter((d) => d.online).map((d) => d.id));
  const { periods, devices, window_days: days } = data.online_history;
  const shown = showAll ? periods : periods.slice(0, PERIODS_PREVIEW);
  // The newest period of a device that is online now is still going.
  const ongoing = new Set<string>();
  const latest = new Set<string>();
  for (const p of periods) {
    if (latest.has(p.device_id)) continue;
    latest.add(p.device_id);
    if (online.has(p.device_id)) ongoing.add(`${p.device_id}|${p.started_at}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Online history, last {days} days</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {devices.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No devices.</p>
        ) : (
          <ul className='flex flex-col gap-1 text-sm'>
            {devices.map((d) => (
              <li key={d.device_id} className='flex flex-wrap justify-between gap-2'>
                <span>{names.get(d.device_id) ?? 'Unknown device'}</span>
                <span className='text-muted-foreground'>
                  {d.uptime_pct === null ? (
                    'Not recorded yet'
                  ) : (
                    <>
                      <span className='text-foreground font-medium tabular-nums'>
                        {d.uptime_pct}%
                      </span>{' '}
                      online · {formatDuration(d.online_seconds)}
                      {d.recorded_since && ` · recorded since ${formatDateTime(d.recorded_since)}`}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {periods.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            No online periods recorded yet. They are recorded from each heartbeat and licence
            check-in.
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Came online</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className='text-right'>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => {
                  const live = ongoing.has(`${p.device_id}|${p.started_at}`);
                  const seconds =
                    (new Date(p.last_seen_at).getTime() - new Date(p.started_at).getTime()) / 1000;
                  return (
                    <TableRow key={`${p.device_id}|${p.started_at}`}>
                      <TableCell>{names.get(p.device_id) ?? 'Unknown device'}</TableCell>
                      <TableCell className='text-sm'>{formatDateTime(p.started_at)}</TableCell>
                      <TableCell className='text-sm'>
                        {live ? <Badge>Online now</Badge> : formatDateTime(p.last_seen_at)}
                      </TableCell>
                      <TableCell className='text-right text-sm tabular-nums'>
                        {formatDuration(seconds)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {periods.length > PERIODS_PREVIEW && (
          <Button size='sm' variant='ghost' className='self-start' onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${periods.length}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function BackupsCard({ data }: { data: StoreDetail }) {
  const names = deviceNames(data);
  const { recent, last_success_at: lastSuccess } = data.backups;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center justify-between gap-2 text-base'>
          Backups
          <span className='text-muted-foreground text-sm font-normal'>
            Last good backup: {lastSuccess ? timeAgo(lastSuccess) : 'none reported'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Where</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Device</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.length === 0 && (
              <EmptyRow colSpan={5}>
                No backups reported. The POS reports backups once it is updated to a version that
                sends them.
              </EmptyRow>
            )}
            {recent.map((b) => (
              <TableRow key={b.id}>
                <TableCell className='text-sm'>{formatDateTime(b.occurred_at)}</TableCell>
                <TableCell>
                  {b.status === 'success' ? (
                    <Badge variant='secondary'>Saved</Badge>
                  ) : (
                    <span className='flex flex-col gap-0.5'>
                      <Badge variant='destructive'>Failed</Badge>
                      {b.error && <span className='text-muted-foreground text-xs'>{b.error}</span>}
                    </span>
                  )}
                </TableCell>
                <TableCell className='text-sm'>
                  {BACKUP_DESTINATIONS[b.destination] ?? b.destination}
                  {b.file_name && (
                    <span className='text-muted-foreground block font-mono text-xs'>
                      {b.file_name}
                    </span>
                  )}
                </TableCell>
                <TableCell className='text-sm tabular-nums'>{formatBytes(b.size_bytes)}</TableCell>
                <TableCell className='text-sm'>{names.get(b.device_id) ?? 'Unknown device'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function activityNote(details: Record<string, unknown>): string | null {
  for (const key of ['reason', 'note', 'plan_code', 'email']) {
    const value = details[key];
    if (typeof value === 'string' && value) return value;
  }
  if (typeof details.days === 'number') return `${details.days} days`;
  return null;
}

export function ActivityCard({ data }: { data: StoreDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Admin activity</CardTitle>
      </CardHeader>
      <CardContent>
        {data.activity.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No admin changes to this store yet.</p>
        ) : (
          <ul className='flex flex-col gap-2 text-sm'>
            {data.activity.map((a) => {
              const note = activityNote(a.details);
              return (
                <li key={a.id} className='flex flex-wrap justify-between gap-x-4 gap-y-0.5'>
                  <span>
                    {ACTIVITY_LABELS[a.action] ?? a.action}
                    {note && <span className='text-muted-foreground'> · {note}</span>}
                  </span>
                  <span className='text-muted-foreground'>
                    {a.admin_name ?? 'System'} · {formatDateTime(a.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function localTime(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone
    }).format(new Date());
  } catch {
    return null;
  }
}

/** Where the café is, as its POS reports it; the POS sends no city, PIN code or coordinates. */
export function LocationCard({ data }: { data: StoreDetail }) {
  const { store } = data;
  const country = countryName(store.country);
  const place = [store.address, country].filter(Boolean).join(', ');
  const time = localTime(store.timezone);
  const ips = data.devices.filter((d) => d.last_ip && !d.revoked_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Location</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className='flex flex-col gap-3 text-sm'>
          <div className='flex flex-col gap-0.5'>
            <dt className='text-muted-foreground text-xs'>Address</dt>
            <dd className='break-words'>
              {store.address || '—'}
              {store.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-muted-foreground ml-2 text-xs underline underline-offset-2'
                >
                  Open in Maps
                </a>
              )}
            </dd>
          </div>
          <div className='flex flex-col gap-0.5'>
            <dt className='text-muted-foreground text-xs'>Country</dt>
            <dd>{country ?? '—'}</dd>
          </div>
          <div className='flex flex-col gap-0.5'>
            <dt className='text-muted-foreground text-xs'>Timezone</dt>
            <dd>
              {store.timezone}
              {time && <span className='text-muted-foreground'> · local time {time}</span>}
            </dd>
          </div>
          <div className='flex flex-col gap-0.5'>
            <dt className='text-muted-foreground text-xs'>POS internet address</dt>
            <dd className='flex flex-col'>
              {ips.length === 0
                ? '—'
                : ips.map((d) => (
                    <span key={d.id}>
                      <span className='font-mono text-xs'>{d.last_ip}</span>
                      <span className='text-muted-foreground'>
                        {' '}
                        · {d.device_name ?? 'Unnamed'}, seen {timeAgo(d.last_seen_at)}
                      </span>
                    </span>
                  ))}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
