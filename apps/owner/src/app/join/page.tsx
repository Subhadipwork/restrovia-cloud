'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthCard, FormError, NewPasswordHint, PasswordInput } from '@/features/auth/auth-card';
import { OWNER_QUERY_KEY, useOwner } from '@/features/auth/use-owner';
import { errorMessage, ownerApi } from '@/lib/api-client';

type Preview = {
  store_name: string;
  invited_by: string;
  email: string;
  role: 'manager' | 'owner';
  expires_at: string;
  account: 'new' | 'existing';
};

/** Opened from the email an owner sends to invite a manager to their café. */
function Join() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useSearchParams().get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const preview = useQuery({
    queryKey: ['owner', 'invite', token],
    queryFn: () => ownerApi<Preview>('/invites/preview', { method: 'POST', body: { token } }),
    enabled: !!token,
    retry: false,
  });
  const me = useOwner();
  const signedIn = me.data ?? null;

  const openCafe = async (storeId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['owner'] });
    router.replace(`/dashboard/${storeId}`);
  };
  const createAccount = useMutation({
    mutationFn: () =>
      ownerApi<{ store_id: string }>('/invites/accept-new', {
        method: 'POST',
        body: { token, name, password },
      }),
    onSuccess: (r) => openCafe(r.store_id),
    onError: (err) => setError(errorMessage(err)),
  });
  const accept = useMutation({
    mutationFn: () =>
      ownerApi<{ store_id: string }>('/invites/accept', { method: 'POST', body: { token } }),
    onSuccess: (r) => openCafe(r.store_id),
    onError: (err) => setError(errorMessage(err)),
  });
  const here = `/join?token=${token}`;
  const signInHref = `/sign-in?next=${encodeURIComponent(here)}`;
  // A new person has no password yet, so after signing out they choose one on this page.
  const switchAccount = useMutation({
    mutationFn: () => ownerApi('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.setQueryData(OWNER_QUERY_KEY, null);
      if (preview.data?.account === 'new') router.replace(here);
      else router.push(signInHref);
    },
  });

  if (!token) {
    return (
      <AuthCard title="This link is incomplete">
        <p className="text-sm">Open the link from the invite email again.</p>
      </AuthCard>
    );
  }
  if (preview.isPending) {
    return (
      <AuthCard title="Opening your invite">
        <Skeleton className="h-24" role="status" aria-label="Loading invite" />
      </AuthCard>
    );
  }
  if (preview.error) {
    return (
      <AuthCard title="This invite can’t be used">
        <p className="text-sm">{errorMessage(preview.error)}</p>
      </AuthCard>
    );
  }

  const invite = preview.data;
  const role = invite.role === 'manager' ? 'a manager' : 'an owner';
  const intro = (
    <>
      {invite.invited_by} invited <strong>{invite.email}</strong> to see{' '}
      <strong>{invite.store_name}</strong> on Restrovia as {role}.
    </>
  );

  if (invite.account === 'new' && !signedIn) {
    return (
      <AuthCard
        title={`Join ${invite.store_name}`}
        description={<>{intro} Choose your name and a password. You’ll sign in with this email.</>}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            createAccount.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              autoComplete="name"
              required
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
            />
            <NewPasswordHint />
          </div>
          <FormError message={error} />
          <Button
            type="submit"
            size="lg"
            disabled={createAccount.isPending || !name.trim() || password.length < 8}
          >
            {createAccount.isPending ? 'Saving…' : 'Join the café'}
          </Button>
        </form>
      </AuthCard>
    );
  }

  if (me.isPending) {
    return (
      <AuthCard title={`Join ${invite.store_name}`} description={intro}>
        <Skeleton className="h-10" role="status" aria-label="Checking your sign-in" />
      </AuthCard>
    );
  }

  if (!signedIn) {
    return (
      <AuthCard
        title={`Join ${invite.store_name}`}
        description={<>{intro} Sign in with that email to accept.</>}
      >
        <Button size="lg" className="w-full" onClick={() => router.push(signInHref)}>
          Sign in to accept
        </Button>
      </AuthCard>
    );
  }

  if (signedIn.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <AuthCard
        title="This invite is for another email"
        description={
          <>
            {intro} You’re signed in as <strong>{signedIn.email}</strong>.
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            disabled={switchAccount.isPending}
            onClick={() => switchAccount.mutate()}
          >
            {invite.account === 'new'
              ? `Sign out and join as ${invite.email}`
              : `Sign out and sign in as ${invite.email}`}
          </Button>
          <Button variant="ghost" onClick={() => router.replace('/dashboard/overview')}>
            Not now
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${invite.store_name}`} description={intro}>
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <Button
          size="lg"
          disabled={accept.isPending}
          onClick={() => {
            setError('');
            accept.mutate();
          }}
        >
          {accept.isPending ? 'Accepting…' : 'Accept the invite'}
        </Button>
      </div>
    </AuthCard>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}
