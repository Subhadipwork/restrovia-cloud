'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { FormError, NewPasswordHint, PasswordInput } from '@/features/auth/auth-card';
import { useOwner, type Owner } from '@/features/auth/use-owner';
import { ownerApi, errorMessage } from '@/lib/api-client';
import { deviceName, formatDateTime, SECURITY_EVENT_LABELS, timeAgo } from '@/lib/display';
import { ConfirmDialog, SecondFactorInput, secondFactorBody, TurnOnDialog } from './two-factor';

type Session = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
};
type SecurityEvent = { action: string; ip: string | null; user_agent: string | null; at: string };

function PasswordCard({ owner }: { owner: Owner }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [factor, setFactor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ownerApi('/me/password', {
        method: 'POST',
        body: {
          current_password: current,
          new_password: next,
          ...(owner.two_factor_enabled ? secondFactorBody(factor) : {})
        }
      });
      setCurrent('');
      setNext('');
      setFactor('');
      toast.success('Password changed. Other devices were signed out.');
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs out every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='current-password'>Current password</Label>
            <PasswordInput
              id='current-password'
              autoComplete='current-password'
              value={current}
              onChange={setCurrent}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='new-password'>New password</Label>
            <PasswordInput
              id='new-password'
              autoComplete='new-password'
              value={next}
              onChange={setNext}
            />
            <NewPasswordHint />
          </div>
          {owner.two_factor_enabled && (
            <SecondFactorInput id='password-code' value={factor} onChange={setFactor} />
          )}
          <FormError message={error} />
          <Button type='submit' className='self-start' disabled={busy || next.length < 8}>
            {busy ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TwoFactorCard({ owner }: { owner: Owner }) {
  const [turnOn, setTurnOn] = useState(false);
  const [confirm, setConfirm] = useState<'disable' | 'new-codes' | null>(null);
  const few = owner.two_factor_enabled && owner.recovery_codes_left < 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          Signing in also needs a code from an authenticator app on your phone.
        </CardDescription>
        <CardAction>
          <Badge variant={owner.two_factor_enabled ? 'default' : 'outline'}>
            {owner.two_factor_enabled ? 'On' : 'Off'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-col gap-4 text-sm'>
        {owner.two_factor_enabled ? (
          <>
            <p className='text-muted-foreground'>
              On since {formatDateTime(owner.two_factor_enabled_at)}.
            </p>
            <p className={few ? 'text-destructive' : undefined}>
              {owner.recovery_codes_left} of 10 recovery codes left.
              {few && ' Make new ones before you run out.'}
            </p>
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' onClick={() => setConfirm('new-codes')}>
                Make new recovery codes
              </Button>
              <Button variant='ghost' onClick={() => setConfirm('disable')}>
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <Button className='self-start' onClick={() => setTurnOn(true)}>
            Turn on two-factor authentication
          </Button>
        )}
      </CardContent>
      <TurnOnDialog open={turnOn} onClose={() => setTurnOn(false)} />
      <ConfirmDialog mode={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryKey: ['owner', 'sessions'],
    queryFn: () => ownerApi<{ sessions: Session[] }>('/me/sessions').then((r) => r.sessions)
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['owner'] });
  const revoke = useMutation({
    mutationFn: (id: string) => ownerApi(`/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err))
  });
  const revokeOthers = useMutation({
    mutationFn: () => ownerApi('/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: () => {
      toast.success('Every other device is signed out.');
      return refresh();
    },
    onError: (err) => toast.error(errorMessage(err))
  });
  const others = (data ?? []).filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription>Sign out any device you don’t recognise.</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {isPending && <Skeleton className='h-16 w-full' />}
        {error && <FormError message={errorMessage(error)} />}
        <ul className='divide-y'>
          {data?.map((s) => (
            <li key={s.id} className='flex items-center justify-between gap-3 py-3 text-sm'>
              <div className='min-w-0'>
                <div className='font-medium'>
                  {deviceName(s.user_agent)}
                  {s.current && (
                    <Badge variant='secondary' className='ml-2'>
                      This device
                    </Badge>
                  )}
                </div>
                <div className='text-muted-foreground truncate'>
                  {s.ip ?? 'Unknown network'} · last used {timeAgo(s.last_used_at)}
                </div>
              </div>
              {!s.current && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(s.id)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others > 0 && (
          <Button
            variant='outline'
            className='self-start'
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            Sign out everywhere else
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityCard() {
  const { data, error, isPending } = useQuery({
    queryKey: ['owner', 'security-events'],
    queryFn: () =>
      ownerApi<{ events: SecurityEvent[] }>('/me/security-events').then((r) => r.events)
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Sign-ins and changes to your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && <Skeleton className='h-24 w-full' />}
        {error && <FormError message={errorMessage(error)} />}
        <ul className='divide-y text-sm'>
          {data?.map((e, i) => (
            <li key={`${e.at}-${i}`} className='flex justify-between gap-3 py-2'>
              <div className='min-w-0'>
                <div>{SECURITY_EVENT_LABELS[e.action] ?? e.action}</div>
                <div className='text-muted-foreground truncate'>
                  {[e.user_agent && deviceName(e.user_agent), e.ip].filter(Boolean).join(' · ')}
                </div>
              </div>
              <time className='text-muted-foreground shrink-0' dateTime={e.at}>
                {formatDateTime(e.at)}
              </time>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function SecurityScreen() {
  const { data: owner } = useOwner();
  if (!owner) return null;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <div className='flex flex-col gap-4'>
        <TwoFactorCard owner={owner} />
        <PasswordCard owner={owner} />
      </div>
      <div className='flex flex-col gap-4'>
        <SessionsCard />
        <ActivityCard />
      </div>
    </div>
  );
}
