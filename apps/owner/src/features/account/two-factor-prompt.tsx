'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOwner } from '@/features/auth/use-owner';

const TWO_FACTOR_DISMISSED = 'restrovia.dismiss-2fa-card';

/** A dismissible nudge to turn on 2FA, shown until it is on or the owner says "Not now". */
export function TwoFactorPrompt() {
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

  if (!owner || owner.two_factor_enabled || dismissed) return null;
  return (
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
  );
}
