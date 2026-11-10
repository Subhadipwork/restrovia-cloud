'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api-client';
import { ChooseOwnPassword } from './choose-own-password';
import { useOwner } from './use-owner';

/**
 * Shows the portal only to a signed-in owner; anyone else goes to the sign-in page. An owner on a
 * password a Restrovia admin set chooses their own first.
 */
export function OwnerGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, error, isPending } = useOwner();
  const signedOut = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (signedOut) router.replace('/sign-in');
  }, [signedOut, router]);

  if (data?.must_change_password) return <ChooseOwnPassword owner={data} />;
  if (data) return <>{children}</>;
  if (error && !signedOut) {
    return (
      <div className='text-muted-foreground flex min-h-svh items-center justify-center p-6 text-center'>
        Can’t reach Restrovia right now. Check your internet connection, then reload the page.
      </div>
    );
  }
  return (
    <div className='flex min-h-svh items-center justify-center' role='status' aria-label='Loading'>
      {isPending && <Spinner />}
    </div>
  );
}
