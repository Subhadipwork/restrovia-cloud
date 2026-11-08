'use client';

import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useDebounce } from '@/hooks/use-debounce';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, formatDay, storeCode, timeAgo } from '@/lib/display';
import { useOwner, useOwnerAction, useOwners, useSetOwnerPassword, type OwnerDetail } from './api';
import { AdminPasswordField, copyText, generatePassword } from './password-field';
import { EmptyRow, Pager, QueryState } from './ui';

const PER_PAGE = 25;

function StatusBadges({ owner }: { owner: OwnerDetail['owner'] }) {
  return (
    <span className='flex flex-wrap gap-1'>
      {owner.status === 'disabled' && <Badge variant='destructive'>Disabled</Badge>}
      {owner.invited && <Badge variant='outline'>Invited, no password yet</Badge>}
      {owner.must_change_password && (
        <Badge variant='outline'>Using the password Restrovia set</Badge>
      )}
      {owner.locked && <Badge variant='destructive'>Locked</Badge>}
      <Badge variant={owner.two_factor_enabled ? 'secondary' : 'outline'}>
        {owner.two_factor_enabled ? '2FA on' : '2FA off'}
      </Badge>
    </span>
  );
}

export function OwnersScreen() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    search: parseAsString.withDefault('')
  });
  const [search, setSearch] = useState(params.search);
  const debounced = useDebounce(search, 400);
  useEffect(() => {
    if (debounced !== params.search) void setParams({ search: debounced, page: 1 });
  }, [debounced, params.search, setParams]);

  const { data, isPending, error } = useOwners({
    search: params.search || undefined,
    page: params.page,
    per_page: PER_PAGE
  });

  return (
    <div className='flex flex-col gap-4'>
      <Input
        aria-label='Search owners'
        placeholder='Search by name, email or phone'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className='w-full sm:max-w-sm'
      />
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Stores</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.length === 0 && (
                  <EmptyRow colSpan={5}>No owner accounts match this search.</EmptyRow>
                )}
                {data.data.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/owners/${o.id}`}
                        className='font-medium hover:underline'
                      >
                        {o.name || o.email}
                      </Link>
                      <div className='text-muted-foreground text-xs'>
                        {[o.email, o.phone].filter(Boolean).join(' · ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadges owner={o} />
                    </TableCell>
                    <TableCell>{o.stores_count}</TableCell>
                    <TableCell className='text-sm'>{timeAgo(o.last_login_at)}</TableCell>
                    <TableCell className='text-sm'>{formatDay(o.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={data.page}
            perPage={data.per_page}
            total={data.total}
            onPage={(page) => void setParams({ page })}
          />
        </>
      )}
    </div>
  );
}

type Action = 'reset-2fa' | 'disable' | 'enable';

const ACTIONS: Record<
  Action,
  { title: string; description: string; button: string; done: string }
> = {
  'reset-2fa': {
    title: 'Reset two-factor authentication',
    description:
      'Only after you have confirmed who is asking: call back the phone number saved on their store and check the store code. Every device the owner is signed in on is signed out, and they are emailed.',
    button: 'Reset 2FA',
    done: 'Two-factor authentication is off for this owner.'
  },
  disable: {
    title: 'Disable this account',
    description: 'The owner is signed out everywhere and can’t sign in until it is enabled again.',
    button: 'Disable account',
    done: 'Account disabled.'
  },
  enable: {
    title: 'Enable this account',
    description: 'The owner can sign in again.',
    button: 'Enable account',
    done: 'Account enabled.'
  }
};

function ActionDialog({
  id,
  action,
  onClose
}: {
  id: string;
  action: Action | null;
  onClose: () => void;
}) {
  const run = useOwnerAction(id);
  const [reason, setReason] = useState('');
  const copy = action ? ACTIONS[action] : null;
  const close = () => {
    setReason('');
    onClose();
  };

  return (
    <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {action && copy && (
          <form
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate(
                { action, reason: reason.trim() || undefined },
                {
                  onSuccess: () => {
                    toast.success(copy.done);
                    close();
                  },
                  onError: (err) => toast.error(errorMessage(err))
                }
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='reason'>
                {action === 'reset-2fa'
                  ? 'Reason and how you checked identity'
                  : 'Reason (optional)'}
              </Label>
              <Textarea
                id='reason'
                required={action === 'reset-2fa'}
                minLength={action === 'reset-2fa' ? 3 : undefined}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={close}>
                Cancel
              </Button>
              <Button
                type='submit'
                variant={action === 'enable' ? 'default' : 'destructive'}
                disabled={run.isPending}
              >
                {run.isPending ? 'Saving…' : copy.button}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({
  id,
  email,
  open,
  onClose
}: {
  id: string;
  email: string;
  open: boolean;
  onClose: () => void;
}) {
  const setPassword = useSetOwnerPassword(id);
  const [password, setPasswordValue] = useState(generatePassword);
  const [saved, setSaved] = useState(false);
  const close = () => {
    setPasswordValue(generatePassword());
    setSaved(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle>New password set</DialogTitle>
              <DialogDescription>
                Every device the owner was signed in on is signed out. Give them this password by
                phone or in person; they choose their own at the next sign-in. It isn’t shown again.
              </DialogDescription>
            </DialogHeader>
            <dl className='bg-muted grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg p-4 text-sm'>
              <dt className='text-muted-foreground'>Email</dt>
              <dd className='break-all'>{email}</dd>
              <dt className='text-muted-foreground'>Password</dt>
              <dd className='font-mono select-all'>{password}</dd>
            </dl>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() =>
                  copyText(
                    `Restrovia owner portal\nEmail: ${email}\nPassword: ${password}`,
                    'Sign-in details'
                  )
                }
              >
                Copy
              </Button>
              <Button type='button' onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              setPassword.mutate(password, {
                onSuccess: () => setSaved(true),
                onError: (err) => toast.error(errorMessage(err))
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Set a new password</DialogTitle>
              <DialogDescription>
                For an owner who can’t sign in. Confirm who is asking first: call back the phone
                number saved on their store. Two-factor authentication stays as it is.
              </DialogDescription>
            </DialogHeader>
            <AdminPasswordField
              id='new-owner-password'
              value={password}
              onChange={setPasswordValue}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={close}>
                Cancel
              </Button>
              <Button type='submit' disabled={setPassword.isPending}>
                {setPassword.isPending ? 'Saving…' : 'Set password'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OwnerDetailScreen({ id }: { id: string }) {
  const { data, isPending, error } = useOwner(id);
  const canAct = useHasRole('super_admin', 'support');
  const canInvite = useHasRole('super_admin', 'support', 'sales');
  const [settingPassword, setSettingPassword] = useState(false);
  const resend = useOwnerAction(id);
  const [action, setAction] = useState<Action | null>(null);

  if (!data) return <QueryState isPending={isPending} error={error} />;
  const { owner } = data;

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>{owner.name || owner.email}</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-3 text-sm'>
          <StatusBadges owner={owner} />
          <dl className='grid gap-x-6 gap-y-2 sm:grid-cols-2'>
            <div>
              <dt className='text-muted-foreground'>Email</dt>
              <dd className='break-all'>{owner.email}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>Phone</dt>
              <dd>{owner.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>Last sign-in</dt>
              <dd>{formatDateTime(owner.last_login_at)}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>Joined</dt>
              <dd>{formatDateTime(owner.created_at)}</dd>
            </div>
          </dl>
          {owner.invited && canInvite && owner.status === 'active' && (
            <Button
              variant='outline'
              className='self-start'
              disabled={resend.isPending}
              onClick={() =>
                resend.mutate(
                  { action: 'resend-invite' },
                  {
                    onSuccess: () => toast.success(`A new invite was sent to ${owner.email}.`),
                    onError: (err) => toast.error(errorMessage(err))
                  }
                )
              }
            >
              Resend invite
            </Button>
          )}
          {canAct && (
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' onClick={() => setSettingPassword(true)}>
                Set new password
              </Button>
              {owner.two_factor_enabled && (
                <Button variant='outline' onClick={() => setAction('reset-2fa')}>
                  Reset 2FA
                </Button>
              )}
              {owner.status === 'active' ? (
                <Button variant='outline' onClick={() => setAction('disable')}>
                  Disable account
                </Button>
              ) : (
                <Button variant='outline' onClick={() => setAction('enable')}>
                  Enable account
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Linked stores</CardTitle>
          </CardHeader>
          <CardContent>
            {data.stores.length === 0 ? (
              <p className='text-muted-foreground text-sm'>No store linked yet.</p>
            ) : (
              <ul className='flex flex-col gap-2 text-sm'>
                {data.stores.map((s) => (
                  <li key={s.id} className='flex justify-between gap-2'>
                    <Link href={`/dashboard/stores/${s.id}`} className='hover:underline'>
                      {s.name || 'Unnamed store'}{' '}
                      <span className='text-muted-foreground font-mono'>{storeCode(s.id)}</span>
                    </Link>
                    <span className='text-muted-foreground'>{s.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Recent sign-ins and changes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.security_events.length === 0 ? (
              <p className='text-muted-foreground text-sm'>Nothing yet.</p>
            ) : (
              <ul className='flex flex-col gap-2 text-sm'>
                {data.security_events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className='flex justify-between gap-2'>
                    <span className='font-mono text-xs'>{e.action}</span>
                    <span className='text-muted-foreground'>
                      {e.ip ? `${e.ip} · ` : ''}
                      {formatDateTime(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ActionDialog id={id} action={action} onClose={() => setAction(null)} />
      <SetPasswordDialog
        id={id}
        email={owner.email}
        open={settingPassword}
        onClose={() => setSettingPassword(false)}
      />
    </div>
  );
}
