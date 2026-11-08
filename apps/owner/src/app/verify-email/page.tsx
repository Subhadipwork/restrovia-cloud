'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AuthCard, FormError } from '@/features/auth/auth-card';
import { OWNER_QUERY_KEY } from '@/features/auth/use-owner';
import { ownerApi, errorMessage } from '@/lib/api-client';

/** Opened from the link in a change-email message. */
function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();
  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) return;
    ownerApi('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => {
        setState('done');
        return queryClient.invalidateQueries({ queryKey: OWNER_QUERY_KEY });
      })
      .catch((err) => {
        setState('failed');
        setError(errorMessage(err));
      });
  }, [token, queryClient]);

  if (!token) {
    return (
      <AuthCard title='This link didn’t work'>
        <FormError message='This link is incomplete. Open the link from the email again.' />
      </AuthCard>
    );
  }
  if (state === 'checking') {
    return (
      <AuthCard title='Confirming your email'>
        <div className='flex justify-center py-4' role='status' aria-label='Checking'>
          <Spinner />
        </div>
      </AuthCard>
    );
  }
  if (state === 'failed') {
    return (
      <AuthCard title='This link didn’t work'>
        <div className='flex flex-col gap-4'>
          <FormError message={error} />
          <p className='text-muted-foreground text-sm'>
            Sign in to send a new link from the Restrovia portal.
          </p>
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
    <AuthCard title='Email confirmed'>
      <div className='flex flex-col gap-4'>
        <p className='text-sm'>Thank you. Your email is confirmed.</p>
        <Button
          size='lg'
          nativeButton={false}
          render={<Link href='/dashboard/overview' aria-label='Continue' />}
        >
          Continue
        </Button>
      </div>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
