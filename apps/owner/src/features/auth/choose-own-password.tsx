'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SecondFactorInput, secondFactorBody } from '@/features/account/two-factor';
import { ownerApi, errorMessage } from '@/lib/api-client';
import { AuthCard, FormError, NewPasswordHint, PasswordInput } from './auth-card';
import { useSignOut, type Owner } from './use-owner';

/** Shown instead of the portal while the owner is still on a password a Restrovia admin set. */
export function ChooseOwnPassword({ owner }: { owner: Owner }) {
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [factor, setFactor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ownerApi('/me/password', {
        method: 'POST',
        body: {
          current_password: current,
          new_password: next,
          ...(owner.two_factor_enabled ? secondFactorBody(factor) : {})
        }
      });
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title='Choose your own password'
      description='Restrovia set your current password. Replace it with one only you know.'
      footer={
        <Button variant='link' onClick={() => signOut.mutate()}>
          Sign out
        </Button>
      }
    >
      <form onSubmit={submit} className='flex flex-col gap-4'>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='current-password'>Password from Restrovia</Label>
          <PasswordInput
            id='current-password'
            autoComplete='current-password'
            value={current}
            onChange={setCurrent}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='new-password'>New password</Label>
          <PasswordInput
            id='new-password'
            autoComplete='new-password'
            value={next}
            onChange={setNext}
          />
          <NewPasswordHint />
        </div>
        {owner.two_factor_enabled && (
          <SecondFactorInput id='own-password-code' value={factor} onChange={setFactor} />
        )}
        <FormError message={error} />
        <Button type='submit' size='lg' disabled={busy || next.length < 8}>
          {busy ? 'Saving…' : 'Save and continue'}
        </Button>
      </form>
    </AuthCard>
  );
}
