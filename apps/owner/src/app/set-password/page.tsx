'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AuthCard, FormError, NewPasswordHint, PasswordInput } from '@/features/auth/auth-card';
import { OWNER_QUERY_KEY } from '@/features/auth/use-owner';
import { ownerApi, ApiError, errorMessage } from '@/lib/api-client';

/** Opened from the invite email the Restrovia team sends when they create an owner account. */
function SetPassword() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [setUp, setSetUp] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setExpired(false);
    setBusy(true);
    try {
      await ownerApi('/auth/set-password', { method: 'POST', body: { token, password } });
      await queryClient.invalidateQueries({ queryKey: OWNER_QUERY_KEY });
      router.replace('/dashboard/overview');
    } catch (err) {
      if (err instanceof ApiError && err.body.error === 'already_set_up') setSetUp(true);
      else {
        setExpired(err instanceof ApiError && err.body.error === 'invalid_token');
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (setUp) {
    return (
      <AuthCard title='Your account is already set up'>
        <div className='flex flex-col gap-4'>
          <p className='text-sm'>You chose a password already. Sign in with it.</p>
          <Button
            size='lg'
            nativeButton={false}
            render={<Link href='/sign-in' aria-label='Sign in' />}
          >
            Sign in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title='Welcome to Restrovia'
      description='Choose a password for your account. You’ll use it with your email to sign in.'
      footer={
        <Link href='/sign-in' className='text-foreground underline underline-offset-4'>
          Already have a password? Sign in
        </Link>
      }
    >
      <form onSubmit={submit} className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='password'>Password</Label>
          <PasswordInput
            id='password'
            autoComplete='new-password'
            value={password}
            onChange={setPassword}
          />
          <NewPasswordHint />
        </div>
        <FormError
          message={token ? error : 'This link is incomplete. Open the link from the email again.'}
        />
        {expired && (
          <p className='text-muted-foreground text-sm'>
            Ask Restrovia support to send a new invite, or use{' '}
            <Link href='/forgot-password' className='text-foreground underline underline-offset-4'>
              Forgot password
            </Link>
            .
          </p>
        )}
        <Button type='submit' size='lg' disabled={busy || !token || password.length < 8}>
          {busy ? 'Saving…' : 'Save and continue'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPassword />
    </Suspense>
  );
}
