'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard, FormError } from '@/features/auth/auth-card';
import { ownerApi, errorMessage } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ownerApi('/auth/password/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link href='/sign-in' className='text-foreground underline underline-offset-4'>
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title='Check your email' footer={back}>
        <p className='text-sm'>
          If <strong className='break-all'>{email}</strong> has a Restrovia account, we sent it a
          link to choose a new password. The link works for 30 minutes.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title='Forgot your password?'
      description='Enter your email and we’ll send you a link to choose a new one.'
      footer={back}
    >
      <form onSubmit={submit} className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='email'>Email</Label>
          <Input
            id='email'
            type='email'
            autoComplete='email'
            inputMode='email'
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type='submit' size='lg' disabled={busy}>
          {busy ? 'Sending…' : 'Send link'}
        </Button>
      </form>
    </AuthCard>
  );
}
