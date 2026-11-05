'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api-client';
import { useAdmin } from './use-admin';

/** Shows the panel only to a signed-in admin; anyone else goes to the sign-in page. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, error, isPending } = useAdmin();
  const signedOut = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (signedOut) router.replace('/sign-in');
  }, [signedOut, router]);

  if (data) return <>{children}</>;
  if (error && !signedOut) {
    return (
      <div className='text-muted-foreground flex min-h-svh items-center justify-center p-6 text-center'>
        Can’t reach the Restrovia Cloud API. Check that it is running, then reload the page.
      </div>
    );
  }
  return (
    <div className='flex min-h-svh items-center justify-center' role='status' aria-label='Loading'>
      {isPending && <Spinner />}
    </div>
  );
}
