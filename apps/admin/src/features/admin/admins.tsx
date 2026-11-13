'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useAdmin, useCan } from '@/features/auth/use-admin';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/display';
import { type AdminUser, useAdminAction, useAdminRoles, useAdmins, useCreateAdmin } from './api';
import { QueryState } from './ui';

function NewAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAdmin();
  const roles = useAdminRoles();
  const assignable = roles.data?.filter((r) => r.assignable) ?? [];
  const [form, setForm] = useState({ name: '', email: '', role: '', password: '' });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(form, {
              onSuccess: () => {
                toast.success(`${form.name} added. They set up two-step sign-in on first sign-in.`);
                setForm({ name: '', email: '', role: '', password: '' });
                onClose();
              },
              onError: (err) => toast.error(errorMessage(err))
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add an admin</DialogTitle>
            <DialogDescription>
              Give them the email and the starting password in person or by phone, not by email.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='name'>Name</Label>
            <Input id='name' required maxLength={100} value={form.name} onChange={set('name')} />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='email'>Email</Label>
            <Input id='email' type='email' required value={form.email} onChange={set('email')} />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='role'>Role</Label>
            <NativeSelect
              id='role'
              className='w-full'
              required
              value={form.role}
              onChange={set('role')}
            >
              <NativeSelectOption value='' disabled>
                Choose a role
              </NativeSelectOption>
              {assignable.map((r) => (
                <NativeSelectOption key={r.key} value={r.key}>
                  {r.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className='text-muted-foreground text-xs'>
              {assignable.find((r) => r.key === form.role)?.description}
            </p>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='password'>Starting password (at least 12 characters)</Label>
            <Input
              id='password'
              type='password'
              autoComplete='new-password'
              minLength={12}
              required
              value={form.password}
              onChange={set('password')}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add admin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminsScreen() {
  const { data, isPending, error } = useAdmins();
  const { data: me } = useAdmin();
  const action = useAdminAction();
  const canManage = useCan('users.manage');
  const [adding, setAdding] = useState(false);

  const run = (a: AdminUser, kind: 'disable' | 'enable' | 'reset-2fa', done: string) =>
    action.mutate(
      { id: a.id, action: kind },
      { onSuccess: () => toast.success(done), onError: (err) => toast.error(errorMessage(err)) }
    );

  return (
    <div className='flex flex-col gap-4'>
      {canManage && (
        <Button className='self-start' onClick={() => setAdding(true)}>
          Add admin
        </Button>
      )}
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Two-step sign-in</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className='font-medium'>
                      {a.name}{' '}
                      {a.id === me?.id && (
                        <span className='text-muted-foreground text-xs'>(you)</span>
                      )}
                    </div>
                    <div className='text-muted-foreground text-xs'>{a.email}</div>
                  </TableCell>
                  <TableCell>
                    {a.role_name}
                    {a.status === 'disabled' && (
                      <Badge variant='destructive' className='ml-2'>
                        Disabled
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.two_factor ? (
                      'On'
                    ) : (
                      <span className='text-muted-foreground'>Set up at next sign-in</span>
                    )}
                  </TableCell>
                  <TableCell className='text-sm'>{formatDateTime(a.last_login_at)}</TableCell>
                  <TableCell className='text-right'>
                    {canManage && a.manageable && (
                      <div className='flex justify-end gap-2'>
                        {a.two_factor && (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={action.isPending}
                            onClick={() =>
                              run(a, 'reset-2fa', `Two-step sign-in reset for ${a.name}`)
                            }
                          >
                            Reset 2FA
                          </Button>
                        )}
                        {a.status === 'active' ? (
                          <Button
                            size='sm'
                            variant='destructive'
                            disabled={action.isPending}
                            onClick={() => run(a, 'disable', `${a.name} disabled and signed out`)}
                          >
                            Disable
                          </Button>
                        ) : (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={action.isPending}
                            onClick={() => run(a, 'enable', `${a.name} enabled`)}
                          >
                            Enable
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {canManage && <NewAdminDialog open={adding} onClose={() => setAdding(false)} />}
    </div>
  );
}
