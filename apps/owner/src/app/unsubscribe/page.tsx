'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthCard, FormError } from '@/features/auth/auth-card';
import { errorMessage, ownerApi } from '@/lib/api-client';

const KIND_LABELS: Record<string, string> = {
  daily_summary: 'Daily summaries',
  store_offline: 'POS offline alerts'
};

/** Opened from "turn off" at the bottom of an alert email; works without signing in. */
function Unsubscribe() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'ask' | 'busy' | 'done'>('ask');
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');

  // A button, not an automatic request: mail scanners open links and must not change anything.
  const turnOff = async () => {
    setState('busy');
    setError('');
    try {
      const res = await ownerApi<{ kind: string }>('/notifications/unsubscribe', {
        method: 'POST',
        body: { token }
      });
      setKind(res.kind);
      setState('done');
    } catch (err) {
      setError(errorMessage(err));
      setState('ask');
    }
  };

  if (!token) {
    return (
      <AuthCard title='This link didn’t work'>
        <FormError message='This link is incomplete. Open the link from the email again.' />
      </AuthCard>
    );
  }
  if (state === 'done') {
    return (
      <AuthCard title='Turned off'>
        <div className='flex flex-col gap-4'>
          <p className='text-sm'>
            {KIND_LABELS[kind] ?? 'These emails'} are off. You can turn them on again from Account →
            Alerts.
          </p>
          <Button
            size='lg'
            variant='outline'
            nativeButton={false}
            render={<Link href='/dashboard/account/alerts' aria-label='Open alerts' />}
          >
            Open alerts
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title='Turn off these emails?'>
      <div className='flex flex-col gap-4'>
        <p className='text-sm'>
          Restrovia will stop sending you this kind of alert. Your other alerts stay as they are.
        </p>
        {error && <FormError message={error} />}
        <Button size='lg' disabled={state === 'busy'} onClick={turnOff}>
          {state === 'busy' ? 'Turning off…' : 'Turn off'}
        </Button>
      </div>
    </AuthCard>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <Unsubscribe />
    </Suspense>
  );
}
