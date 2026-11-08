'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError, PasswordInput } from '@/features/auth/auth-card';
import { OWNER_QUERY_KEY, useOwner, type Owner } from '@/features/auth/use-owner';
import { ownerApi, errorMessage } from '@/lib/api-client';

function ProfileCard({ owner }: { owner: Owner }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(owner.name);
  const [phone, setPhone] = useState(owner.phone ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await ownerApi<{ owner: Owner }>('/me', {
        method: 'PATCH',
        body: { name, phone: phone.trim() ? phone.replace(/[\s-]/g, '') : null }
      });
      queryClient.setQueryData(OWNER_QUERY_KEY, res.owner);
      toast.success('Profile saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='name'>Name</Label>
            <Input
              id='name'
              autoComplete='name'
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='phone'>Phone (optional)</Label>
            <Input
              id='phone'
              type='tel'
              autoComplete='tel'
              placeholder='+91 98000 00000'
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              With the country code. Used only to contact you about your account.
            </p>
          </div>
          <FormError message={error} />
          <Button type='submit' className='self-start' disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailCard({ owner }: { owner: Owner }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await ownerApi('/me/email', { method: 'POST', body: { new_email: email, password } });
      setSentTo(email);
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>
          You sign in with <strong className='break-all'>{owner.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <div className='flex flex-col gap-3 text-sm'>
            <p>
              We sent a link to <strong className='break-all'>{sentTo}</strong>. Your email changes
              when you open it.
            </p>
            <Button variant='outline' className='self-start' onClick={() => setSentTo('')}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='new-email'>New email</Label>
              <Input
                id='new-email'
                type='email'
                autoComplete='email'
                inputMode='email'
                required
                maxLength={255}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='email-password'>Your password</Label>
              <PasswordInput
                id='email-password'
                autoComplete='current-password'
                value={password}
                onChange={setPassword}
              />
            </div>
            <FormError message={error} />
            <Button type='submit' className='self-start' disabled={busy}>
              {busy ? 'Sending…' : 'Change email'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function ProfileScreen() {
  const { data: owner } = useOwner();
  if (!owner) return null;
  return (
    <div className='grid max-w-2xl gap-4'>
      <ProfileCard owner={owner} />
      <EmailCard owner={owner} />
    </div>
  );
}
