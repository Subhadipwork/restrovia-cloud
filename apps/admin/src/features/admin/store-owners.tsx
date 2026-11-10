'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useHasRole } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { useAddOwner, useRemoveOwner, type StoreDetail } from './api';
import { AdminPasswordField, copyText, generatePassword } from './password-field';

/** The POS keeps the phone as typed; the owner API wants +country format. */
function toE164(phone: string | null, country: string | null): string {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (country === 'IN' && /^\d{10}$/.test(digits)) return `+91${digits}`;
  return '';
}

function CreateOwnerDialog({
  store,
  open,
  onClose
}: {
  store: StoreDetail['store'];
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddOwner(store.id);
  const initial = () => ({
    name: store.contactName ?? '',
    email: store.email ?? '',
    phone: toE164(store.phone, store.country),
    how: 'password' as 'password' | 'invite',
    password: generatePassword()
  });
  const [form, setForm] = useState(initial);
  // Shown once after creating, so the admin can pass the sign-in details on.
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const set = (k: 'name' | 'email' | 'phone') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const close = () => {
    setForm(initial());
    setCreated(null);
    onClose();
  };

  if (created) {
    const details = `Restrovia owner portal\nEmail: ${created.email}\nPassword: ${created.password}`;
    return (
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Account created</DialogTitle>
            <DialogDescription>
              Give the owner these sign-in details by phone or in person. They choose their own
              password when they first sign in. The password isn’t shown again.
            </DialogDescription>
          </DialogHeader>
          <dl className='bg-muted grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg p-4 text-sm'>
            <dt className='text-muted-foreground'>Email</dt>
            <dd className='break-all'>{created.email}</dd>
            <dt className='text-muted-foreground'>Password</dt>
            <dd className='font-mono select-all'>{created.password}</dd>
          </dl>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => copyText(details, 'Sign-in details')}
            >
              Copy
            </Button>
            <Button type='button' onClick={close}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            const phone = form.phone.replace(/[\s-]/g, '');
            const password = form.how === 'password' ? form.password : undefined;
            add.mutate(
              {
                name: form.name,
                email: form.email,
                ...(phone ? { phone } : {}),
                ...(password ? { password } : {})
              },
              {
                onSuccess: (res) => {
                  if (res.password_set && password) {
                    setCreated({ email: form.email, password });
                    return;
                  }
                  toast.success(
                    res.created
                      ? `Account created. ${form.email} was sent a link to choose a password.`
                      : `${form.email} already had an account; this store was added to it and their password is unchanged.`
                  );
                  close();
                },
                onError: (err) => toast.error(errorMessage(err))
              }
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Create owner account</DialogTitle>
            <DialogDescription>
              Filled in from the details the POS sent. Check the email with the owner: it is how
              they sign in.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='owner-name'>Name</Label>
            <Input
              id='owner-name'
              required
              maxLength={100}
              value={form.name}
              onChange={set('name')}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='owner-email'>Email</Label>
            <Input
              id='owner-email'
              type='email'
              required
              maxLength={255}
              value={form.email}
              onChange={set('email')}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='owner-phone'>Phone (optional, with country code)</Label>
            <Input
              id='owner-phone'
              type='tel'
              placeholder='+919800000000'
              value={form.phone}
              onChange={set('phone')}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='owner-how'>First password</Label>
            <NativeSelect
              id='owner-how'
              className='w-full'
              value={form.how}
              onChange={(e) =>
                setForm((f) => ({ ...f, how: e.target.value as 'password' | 'invite' }))
              }
            >
              <NativeSelectOption value='password'>
                I set it now and tell the owner
              </NativeSelectOption>
              <NativeSelectOption value='invite'>
                Email the owner a link to choose one
              </NativeSelectOption>
            </NativeSelect>
          </div>
          {form.how === 'password' && (
            <AdminPasswordField
              id='owner-password'
              value={form.password}
              onChange={(password) => setForm((f) => ({ ...f, password }))}
            />
          )}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={close}>
              Cancel
            </Button>
            <Button type='submit' disabled={add.isPending}>
              {add.isPending
                ? 'Creating…'
                : form.how === 'password'
                  ? 'Create account'
                  : 'Create and send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StoreOwnersCard({ data }: { data: StoreDetail }) {
  const canCreate = useHasRole('super_admin', 'support', 'sales');
  const canUnlink = useHasRole('super_admin', 'support');
  const remove = useRemoveOwner(data.store.id);
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Owners and managers</CardTitle>
        {canCreate && (
          <CardAction>
            <Button size='sm' onClick={() => setCreating(true)}>
              Create owner account
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {data.members.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            No owner account yet. Create one so the owner can see this store in the owner portal.
          </p>
        ) : (
          <ul className='flex flex-col gap-3 text-sm'>
            {data.members.map((m) => (
              <li key={m.owner_id} className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <Link href={`/dashboard/owners/${m.owner_id}`} className='hover:underline'>
                    {m.name || m.email}
                  </Link>{' '}
                  <span className='text-muted-foreground'>· {m.role}</span>
                  {m.invited && (
                    <Badge variant='outline' className='ml-2'>
                      Invited
                    </Badge>
                  )}
                  <div className='text-muted-foreground break-all'>{m.email}</div>
                </div>
                {canUnlink && (
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!window.confirm(`Remove ${m.email} from this store?`)) return;
                      remove.mutate(m.owner_id, {
                        onSuccess: () => toast.success('Removed from this store.'),
                        onError: (err) => toast.error(errorMessage(err))
                      });
                    }}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CreateOwnerDialog store={data.store} open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}
