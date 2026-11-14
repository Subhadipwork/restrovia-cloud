'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, errorMessage } from '@/lib/api-client';

const PASSWORD_HINT = 'At least 12 characters. A few unrelated words work well.';

function AuthCard({
  title,
  description,
  children
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className='bg-muted/40 flex min-h-svh items-center justify-center p-4'>
      <Card className='w-full max-w-sm'>
        <CardHeader>
          <CardTitle className='text-xl'>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>{children}</CardContent>
      </Card>
    </main>
  );
}

const toSignIn = (label = 'Go to sign in') => (
  <Link href='/sign-in' className={buttonVariants()}>
    {label}
  </Link>
);

/** Choosing a password twice, so a typo doesn't lock the person out. */
function NewPasswordForm({
  email,
  submitLabel,
  onSubmit
}: {
  email?: string;
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className='flex flex-col gap-4'
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== repeat) {
          setError('The two passwords are different.');
          return;
        }
        setBusy(true);
        setError('');
        try {
          await onSubmit(password);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {email && <input type='email' autoComplete='username' value={email} readOnly hidden />}
      <div className='flex flex-col gap-2'>
        <Label htmlFor='new-password'>New password</Label>
        <Input
          id='new-password'
          type='password'
          autoComplete='new-password'
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className='text-muted-foreground text-xs'>{PASSWORD_HINT}</p>
      </div>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='repeat-password'>Type it again</Label>
        <Input
          id='repeat-password'
          type='password'
          autoComplete='new-password'
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </div>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type='submit' disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

export function AcceptInviteScreen({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => adminApi<{ name: string; email: string }>('/auth/invite', { query: { token } }),
    enabled: !!token,
    retry: false
  });

  if (!token || info.error) {
    return (
      <AuthCard
        title='This invite link doesn’t work'
        description='It may have been used already, replaced by a newer invite, or expired after 7 days. Ask whoever invited you to send a new one.'
      >
        {toSignIn()}
      </AuthCard>
    );
  }
  if (!info.data) {
    return (
      <AuthCard title='Restrovia Admin'>
        <Skeleton className='h-32 w-full' />
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard
        title='Password saved'
        description='Now sign in with your email and new password. You can turn on an authenticator app from your account page later.'
      >
        {toSignIn('Sign in')}
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Welcome, ${info.data.name}`}
      description={`Choose a password for ${info.data.email} to join the Restrovia admin panel.`}
    >
      <NewPasswordForm
        email={info.data.email}
        submitLabel='Save password'
        onSubmit={async (password) => {
          await adminApi('/auth/accept-invite', { method: 'POST', body: { token, password } });
          setDone(true);
        }}
      />
    </AuthCard>
  );
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (sent) {
    return (
      <AuthCard
        title='Check your email'
        description={`If ${email} belongs to a Restrovia admin, a link to choose a new password is on its way. It works for an hour.`}
      >
        {toSignIn('Back to sign in')}
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title='Forgot your password?'
      description='We’ll email you a link to choose a new one. If you turned on an authenticator app, you’ll still need its code to sign in.'
    >
      <form
        className='flex flex-col gap-4'
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await adminApi('/auth/forgot-password', { method: 'POST', body: { email } });
            setSent(true);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className='flex flex-col gap-2'>
          <Label htmlFor='email'>Email</Label>
          <Input
            id='email'
            type='email'
            autoComplete='username'
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type='submit' disabled={busy}>
          {busy ? 'Sending…' : 'Email me a link'}
        </Button>
        <Link href='/sign-in' className={buttonVariants({ variant: 'ghost' })}>
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordScreen({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  if (!token) {
    return (
      <AuthCard
        title='This link doesn’t work'
        description='Ask for a new password link from the sign-in page.'
      >
        <Link href='/forgot-password' className={buttonVariants()}>
          Get a new link
        </Link>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard
        title='Password changed'
        description='You’ve been signed out everywhere. Sign in with the new password (and your authenticator code, if it’s on).'
      >
        {toSignIn('Sign in')}
      </AuthCard>
    );
  }
  return (
    <AuthCard title='Choose a new password'>
      <NewPasswordForm
        submitLabel='Save new password'
        onSubmit={async (password) => {
          await adminApi('/auth/reset-password', { method: 'POST', body: { token, password } });
          setDone(true);
        }}
      />
      <Link href='/forgot-password' className={buttonVariants({ variant: 'ghost' })}>
        Link expired? Get a new one
      </Link>
    </AuthCard>
  );
}
