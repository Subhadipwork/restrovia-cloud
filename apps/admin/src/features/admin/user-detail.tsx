'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAdmin, useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { ACTIVITY_LABELS, formatDateTime, timeAgo } from '@/lib/display';
import { type AdminSession, useAdminDetail, useEndAdminSession } from './api';
import { EditUserDialog, StatusBadge, UserActions } from './admins';
import { PermissionChecklist } from './roles';
import { QueryState } from './ui';

/** "Chrome on macOS" from a user-agent string; good enough to tell someone's devices apart. */
export function describeBrowser(ua: string | null): string {
  if (!ua) return 'Unknown browser';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SessionList({
  sessions,
  onEnd,
  ending
}: {
  sessions: (AdminSession & { current?: boolean })[];
  onEnd?: (id: string) => void;
  ending?: boolean;
}) {
  if (sessions.length === 0) {
    return <p className='text-muted-foreground text-sm'>Not signed in anywhere.</p>;
  }
  return (
    <ul className='flex flex-col divide-y text-sm'>
      {sessions.map((s) => (
        <li key={s.id} className='flex flex-wrap items-center justify-between gap-2 py-2'>
          <div>
            <div className='font-medium'>
              {describeBrowser(s.user_agent)}{' '}
              {s.current && <Badge variant='secondary'>This browser</Badge>}
            </div>
            <div className='text-muted-foreground text-xs'>
              {s.ip ?? 'Unknown IP'} · signed in {formatDateTime(s.created_at)} · active{' '}
              {timeAgo(s.last_seen_at ?? s.created_at)}
            </div>
          </div>
          {onEnd && !s.current && (
            <Button size='sm' variant='outline' disabled={ending} onClick={() => onEnd(s.id)}>
              Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const actionLabel = (action: string) =>
  ACTIVITY_LABELS[action] ??
  action
    .replace(/^[a-z]+\./, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

export function UserDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { data: me } = useAdmin();
  const canManage = useCan('users.manage');
  const seesAudit = useCan('audit.view');
  const { data, isPending, error } = useAdminDetail(id);
  const endSession = useEndAdminSession(id);
  const [editing, setEditing] = useState(false);

  if (id === me?.id) {
    return (
      <p className='text-sm'>
        This is you. Change your own details from{' '}
        <Link href='/dashboard/account' className='underline'>
          My account
        </Link>
        .
      </p>
    );
  }
  if (!data) return <QueryState isPending={isPending} error={error} rows={6} />;
  const { admin: a } = data;
  const mayChange = canManage && data.manageable;

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
          <div>
            <CardTitle className='flex flex-wrap items-center gap-2 text-xl'>
              {a.name} <StatusBadge status={a.status} />
            </CardTitle>
            <CardDescription>{a.email}</CardDescription>
          </div>
          {mayChange && (
            <UserActions
              user={a}
              onEdit={() => setEditing(true)}
              onDone={(kind) => kind === 'cancel-invite' && router.replace('/dashboard/admins')}
            />
          )}
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-2 gap-4 text-sm md:grid-cols-4'>
            <Fact label='Role'>
              <Link href={`/dashboard/roles/${a.role_id}`} className='hover:underline'>
                {a.role_name}
              </Link>
            </Fact>
            <Fact label='Two-step sign-in'>
              {a.two_factor ? 'On' : a.status === 'invited' ? '—' : 'Set up at next sign-in'}
            </Fact>
            <Fact label='Last sign-in'>
              {a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}
            </Fact>
            <Fact label='Password changed'>
              {a.password_changed_at ? formatDateTime(a.password_changed_at) : '—'}
            </Fact>
            <Fact label={a.status === 'invited' ? 'Invited' : 'Added'}>
              {formatDateTime(a.invited_at ?? a.created_at)}
              {a.invited_by_name && ` by ${a.invited_by_name}`}
            </Fact>
          </dl>
          {!data.manageable && canManage && (
            <p className='text-muted-foreground mt-4 text-xs'>
              Their role allows things yours doesn’t, so you can view this account but not change
              it.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Signed in on ({data.sessions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionList
            sessions={data.sessions}
            ending={endSession.isPending}
            onEnd={
              mayChange
                ? (sessionId) =>
                    endSession.mutate(sessionId, {
                      onSuccess: () => toast.success('Signed out of that browser'),
                      onError: (err) => toast.error(errorMessage(err))
                    })
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>
            What they can do{' '}
            <span className='text-muted-foreground font-normal'>
              ({a.permissions.length} permissions from {a.role_name})
            </span>
          </CardTitle>
          <CardDescription>
            To change this, give them another role or{' '}
            <Link href={`/dashboard/roles/${a.role_id}`} className='underline'>
              edit the {a.role_name} role
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionChecklist
            selected={new Set(a.permissions)}
            onToggle={() => undefined}
            readOnly
            mine={new Set(a.permissions)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Recent activity</CardTitle>
          {seesAudit && (
            <CardDescription>
              <Link href={`/dashboard/audit-log?admin_id=${a.id}`} className='underline'>
                Everything they’ve done, in the audit log
              </Link>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {data.activity.length === 0 ? (
            <p className='text-muted-foreground text-sm'>Nothing yet.</p>
          ) : (
            <ul className='flex flex-col gap-1 text-sm'>
              {data.activity.map((e) => (
                <li key={e.id} className='flex flex-wrap justify-between gap-2'>
                  <span>{actionLabel(e.action)}</span>
                  <span className='text-muted-foreground text-xs'>
                    {formatDateTime(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing && <EditUserDialog user={a} onClose={() => setEditing(false)} />}
    </div>
  );
}
