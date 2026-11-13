'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/display';
import {
  useChangeMyPassword,
  useEndMySession,
  useMyAccount,
  useRenameMe,
  useRestartMyTwoFactor
} from './api';
import { QueryState } from './ui';
import { SessionList } from './user-detail';

const onError = (err: unknown) => toast.error(errorMessage(err));

function NameCard({ name }: { name: string }) {
  const rename = useRenameMe();
  const [value, setValue] = useState(name);
  return (
    <form
      className='flex flex-wrap items-end gap-2'
      onSubmit={(e) => {
        e.preventDefault();
        rename.mutate(value.trim(), { onSuccess: () => toast.success('Name saved'), onError });
      }}
    >
      <div className='flex min-w-56 flex-1 flex-col gap-2'>
        <Label htmlFor='my-name'>Name</Label>
        <Input
          id='my-name'
          required
          maxLength={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Button type='submit' disabled={rename.isPending || value.trim() === name}>
        Save
      </Button>
    </form>
  );
}

function PasswordCard() {
  const change = useChangeMyPassword();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className='flex flex-col gap-3'
      onSubmit={(e) => {
        e.preventDefault();
        if (form.next !== form.repeat) {
          setError('The two new passwords are different.');
          return;
        }
        setError('');
        change.mutate(
          { current_password: form.current, new_password: form.next },
          {
            onSuccess: (r) => {
              toast.success(
                r.other_sessions_ended
                  ? `Password changed. Signed out of ${r.other_sessions_ended} other ${r.other_sessions_ended === 1 ? 'browser' : 'browsers'}.`
                  : 'Password changed'
              );
              setForm({ current: '', next: '', repeat: '' });
            },
            onError: (err) => setError(errorMessage(err))
          }
        );
      }}
    >
      <div className='flex flex-col gap-2'>
        <Label htmlFor='current-password'>Current password</Label>
        <Input
          id='current-password'
          type='password'
          autoComplete='current-password'
          required
          value={form.current}
          onChange={set('current')}
        />
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='next-password'>New password</Label>
          <Input
            id='next-password'
            type='password'
            autoComplete='new-password'
            required
            minLength={12}
            value={form.next}
            onChange={set('next')}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='repeat-password'>Type it again</Label>
          <Input
            id='repeat-password'
            type='password'
            autoComplete='new-password'
            required
            value={form.repeat}
            onChange={set('repeat')}
          />
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        At least 12 characters. Your other browsers are signed out; this one stays signed in.
      </p>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type='submit' className='self-start' disabled={change.isPending}>
        {change.isPending ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}

function TwoFactorCard() {
  const restart = useRestartMyTwoFactor();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ password: '', code: '' });
  if (!open) {
    return (
      <div className='flex flex-col gap-3 text-sm'>
        <p>
          Got a new phone? Move two-step sign-in to it. You need your password and a code from your
          current authenticator app, then you’re signed out and set it up again on the new phone.
        </p>
        <Button variant='outline' className='self-start' onClick={() => setOpen(true)}>
          Move to a new phone
        </Button>
        <p className='text-muted-foreground text-xs'>
          Lost your phone? Ask another admin to reset your two-step sign-in.
        </p>
      </div>
    );
  }
  return (
    <form
      className='flex flex-col gap-3'
      onSubmit={(e) => {
        e.preventDefault();
        restart.mutate(form, {
          onSuccess: () => {
            qc.clear();
            router.replace('/sign-in');
          },
          onError
        });
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='tfa-password'>Password</Label>
          <Input
            id='tfa-password'
            type='password'
            autoComplete='current-password'
            required
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='tfa-code'>Code from your current app</Label>
          <Input
            id='tfa-code'
            inputMode='numeric'
            autoComplete='one-time-code'
            pattern='\d{6}'
            maxLength={6}
            required
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, '') }))}
          />
        </div>
      </div>
      <div className='flex gap-2'>
        <Button type='submit' disabled={restart.isPending}>
          {restart.isPending ? 'Checking…' : 'Sign out and set up again'}
        </Button>
        <Button type='button' variant='ghost' onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AccountScreen() {
  const { data, isPending, error } = useMyAccount();
  const end = useEndMySession();
  if (!data) return <QueryState isPending={isPending} error={error} rows={5} />;
  const { admin: a } = data;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Profile</CardTitle>
          <CardDescription>
            {a.email} · {a.role_name}. Only another admin can change your email or role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NameCard key={a.name} name={a.name} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Password</CardTitle>
          <CardDescription>
            Last changed {a.password_changed_at ? formatDateTime(a.password_changed_at) : 'never'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordCard />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Two-step sign-in</CardTitle>
          <CardDescription>{a.two_factor ? 'On.' : 'Not set up yet.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorCard />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Where you’re signed in</CardTitle>
          <CardDescription>Sign out of any browser you don’t recognise.</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionList
            sessions={data.sessions}
            ending={end.isPending}
            onEnd={(id) =>
              end.mutate(id, {
                onSuccess: () => toast.success('Signed out of that browser'),
                onError
              })
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
