'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AuthCard, FormError, NewPasswordHint, PasswordInput } from '@/features/auth/auth-card';
import { ownerApi, errorMessage } from '@/lib/api-client';

function ResetPassword() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ownerApi('/auth/password/reset', { method: 'POST', body: { token, password } });
      router.replace('/sign-in?notice=reset');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title='Choose a new password'
      description='Every device signed in to your account will be signed out.'
      footer={
        <Link href='/forgot-password' className='text-foreground underline underline-offset-4'>
          Need a new link?
        </Link>
      }
    >
      <form onSubmit={submit} className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='password'>New password</Label>
          <PasswordInput
            id='password'
            autoComplete='new-password'
            value={password}
            onChange={setPassword}
          />
          <NewPasswordHint />
        </div>
        <FormError message={error} />
        <Button type='submit' size='lg' disabled={busy || !token || password.length < 8}>
          {busy ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
