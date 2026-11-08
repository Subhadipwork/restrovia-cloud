'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOwner } from '@/features/auth/use-owner';

const TWO_FACTOR_DISMISSED = 'restrovia.dismiss-2fa-card';

/** First screen after sign-in, until the sales dashboard arrives. */
export function WelcomeScreen() {
  const { data: owner } = useOwner();
  // Rendered only in the browser, after the owner has loaded (see OwnerGate).
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(TWO_FACTOR_DISMISSED) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(TWO_FACTOR_DISMISSED, '1');
    } catch {
      // Private windows can refuse storage; the card just comes back next time.
    }
  };

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>Your café</CardTitle>
          <CardDescription>Restrovia linked your café to this account.</CardDescription>
        </CardHeader>
        <CardContent className='text-sm'>
          Today’s sales, live orders and reports from your Restrovia POS will appear here. Keep the
          POS connected to the internet so they stay up to date.
        </CardContent>
      </Card>

      {owner && !owner.two_factor_enabled && !dismissed && (
        <Card>
          <CardHeader>
            <CardTitle>Protect your account</CardTitle>
            <CardDescription>
              Turn on two-factor authentication, so a stolen password alone can’t open your café’s
              sales.
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-wrap gap-2'>
            <Button
              nativeButton={false}
              render={<Link href='/dashboard/account/security' aria-label='Turn it on' />}
            >
              Turn it on
            </Button>
            <Button variant='ghost' onClick={dismiss}>
              Not now
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
