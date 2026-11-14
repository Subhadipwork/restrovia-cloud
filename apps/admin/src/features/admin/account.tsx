'use client';

import Image from 'next/image';
import QRCode from 'qrcode';
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
  type TwoFactorSetup,
  useDisableMyTwoFactor,
  useEnableMyTwoFactor,
  useRenameMe,
  useStartMyTwoFactor
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

function CodeField({
  id,
  label,
  value,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode='numeric'
        autoComplete='one-time-code'
        pattern='\d{6}'
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </div>
  );
}

/** Turning 2FA on: scan the new secret, then confirm one code from the app. */
function TurnOnForm() {
  const start = useStartMyTwoFactor();
  const enable = useEnableMyTwoFactor();
  const [setup, setSetup] = useState<(TwoFactorSetup & { qr: string }) | null>(null);
  const [code, setCode] = useState('');

  if (!setup) {
    return (
      <div className='flex flex-col gap-3 text-sm'>
        <p>
          Optional. With an authenticator app on your phone, signing in also needs a 6-digit code,
          so a stolen password alone can’t open your account.
        </p>
        <Button
          className='self-start'
          disabled={start.isPending}
          onClick={() =>
            start.mutate(undefined, {
              onSuccess: async (res) =>
                setSetup({
                  ...res,
                  qr: await QRCode.toDataURL(res.otpauth_url, { margin: 1, width: 200 })
                }),
              onError
            })
          }
        >
          {start.isPending ? 'Preparing…' : 'Turn on authenticator app'}
        </Button>
      </div>
    );
  }
  return (
    <form
      className='flex flex-col gap-3 text-sm'
      onSubmit={(e) => {
        e.preventDefault();
        enable.mutate(
          { setup_token: setup.setup_token, code },
          {
            onSuccess: () => {
              toast.success('Authenticator app turned on');
            },
            onError: (err) => {
              setCode('');
              onError(err);
            }
          }
        );
      }}
    >
      <ol className='text-muted-foreground flex list-decimal flex-col gap-3 pl-5'>
        <li>
          Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).
        </li>
        <li>
          Scan this code, or enter the key by hand.
          <div className='mt-2 flex flex-col items-start gap-2'>
            <Image
              src={setup.qr}
              alt='QR code for your authenticator app'
              width={160}
              height={160}
              unoptimized
              className='rounded-md border bg-white'
            />
            <code className='bg-muted text-foreground rounded px-2 py-1 text-xs break-all'>
              {setup.secret}
            </code>
          </div>
        </li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className='max-w-48'>
        <CodeField id='tfa-new-code' label='Code' value={code} onChange={setCode} />
      </div>
      <div className='flex gap-2'>
        <Button type='submit' disabled={enable.isPending || code.length !== 6}>
          {enable.isPending ? 'Checking…' : 'Turn on'}
        </Button>
        <Button type='button' variant='ghost' onClick={() => setSetup(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TurnOffForm() {
  const disable = useDisableMyTwoFactor();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ password: '', code: '' });
  if (!open) {
    return (
      <div className='flex flex-col gap-3 text-sm'>
        <p>
          Signing in needs a code from your authenticator app. Got a new phone? Turn it off here,
          then turn it on again and scan the new code.
        </p>
        <Button variant='outline' className='self-start' onClick={() => setOpen(true)}>
          Turn off authenticator app
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
        disable.mutate(form, {
          onSuccess: () => toast.success('Authenticator app turned off'),
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
        <CodeField
          id='tfa-code'
          label='Code from your app'
          value={form.code}
          onChange={(code) => setForm((f) => ({ ...f, code }))}
        />
      </div>
      <div className='flex gap-2'>
        <Button type='submit' variant='destructive' disabled={disable.isPending}>
          {disable.isPending ? 'Checking…' : 'Turn off'}
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
          <CardDescription>
            {a.two_factor ? 'On: signing in needs your authenticator code.' : 'Off.'}
          </CardDescription>
        </CardHeader>
        <CardContent>{a.two_factor ? <TurnOffForm /> : <TurnOnForm />}</CardContent>
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
