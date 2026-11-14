'use client';

import Link from 'next/link';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
import { formatDateTime, timeAgo } from '@/lib/display';
import {
  type AdminActionKind,
  type AdminUser,
  useAdminAction,
  useAdminRoles,
  useAdmins,
  useInviteAdmin,
  useUpdateAdmin
} from './api';
import { EmptyRow, QueryState } from './ui';

const onError = (err: unknown) => toast.error(errorMessage(err));

export function StatusBadge({ status }: { status: AdminUser['status'] }) {
  if (status === 'invited') return <Badge variant='secondary'>Invited</Badge>;
  if (status === 'disabled') return <Badge variant='destructive'>Disabled</Badge>;
  return <Badge variant='outline'>Active</Badge>;
}

/** Roles the signed-in admin may give, with each role's description under the picker. */
function RolePicker({
  id,
  value,
  onChange
}: {
  id: string;
  value: string;
  onChange: (key: string) => void;
}) {
  const roles = useAdminRoles();
  const assignable = roles.data?.filter((r) => r.assignable) ?? [];
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={id}>Role</Label>
      <NativeSelect
        id={id}
        className='w-full'
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
        {assignable.find((r) => r.key === value)?.description}{' '}
        <Link href='/dashboard/roles' className='underline'>
          See all roles
        </Link>
      </p>
    </div>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invite = useInviteAdmin();
  const [form, setForm] = useState({ name: '', email: '', role: '' });
  const close = () => {
    setForm({ name: '', email: '', role: '' });
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(form, {
              onSuccess: () => {
                toast.success(`Invite sent to ${form.email}`);
                close();
              },
              onError
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              They get an email with a link to choose their password (valid for 7 days). An
              authenticator app is optional; they can turn it on from their account page.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='invite-name'>Name</Label>
            <Input
              id='invite-name'
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='invite-email'>Work email</Label>
            <Input
              id='invite-email'
              type='email'
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <RolePicker
            id='invite-role'
            value={form.role}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
          />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={close}>
              Cancel
            </Button>
            <Button type='submit' disabled={invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  onClose
}: {
  user: Pick<AdminUser, 'id' | 'name' | 'role'> | null;
  onClose: () => void;
}) {
  const update = useUpdateAdmin(user?.id ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState(user?.role ?? '');
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            if (!user) return;
            update.mutate(
              {
                ...(name.trim() !== user.name ? { name: name.trim() } : {}),
                ...(role !== user.role ? { role } : {})
              },
              {
                onSuccess: () => {
                  toast.success('Saved. A new role applies on their next click.');
                  onClose();
                },
                onError
              }
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {user?.name}</DialogTitle>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='edit-name'>Name</Label>
            <Input
              id='edit-name'
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <RolePicker id='edit-role' value={role} onChange={setRole} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={update.isPending || (name.trim() === user?.name && role === user?.role)}
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DONE: Record<AdminActionKind, (name: string) => string> = {
  disable: (n) => `${n} disabled and signed out`,
  enable: (n) => `${n} can sign in again`,
  'reset-2fa': (n) => `Authenticator app turned off for ${n}`,
  'resend-invite': (n) => `A new invite is on its way to ${n}`,
  'cancel-invite': (n) => `Invite for ${n} cancelled`,
  'send-password-reset': (n) => `A password reset link is on its way to ${n}`,
  'end-sessions': (n) => `${n} is signed out everywhere`
};

/** The actions a manageable person's row offers, depending on their status. */
export function UserActions({
  user,
  onEdit,
  onDone
}: {
  user: Pick<AdminUser, 'id' | 'name' | 'status' | 'two_factor'>;
  onEdit: () => void;
  onDone?: (kind: AdminActionKind) => void;
}) {
  const action = useAdminAction();
  const [confirm, setConfirm] = useState<AdminActionKind | null>(null);
  const run = (kind: AdminActionKind) =>
    action.mutate(
      { id: user.id, action: kind },
      {
        onSuccess: () => {
          toast.success(DONE[kind](user.name));
          setConfirm(null);
          onDone?.(kind);
        },
        onError
      }
    );
  const ask = (kind: AdminActionKind) => () => setConfirm(kind);

  const CONFIRM: Partial<
    Record<AdminActionKind, { title: string; body: string; danger?: boolean }>
  > = {
    disable: {
      title: `Disable ${user.name}?`,
      body: 'They are signed out at once and can’t sign in until enabled again. Their name stays on leads, tickets and the audit log.',
      danger: true
    },
    'reset-2fa': {
      title: `Reset two-step sign-in for ${user.name}?`,
      body: 'Use this when they lost their phone. They are signed out, can sign in with just their password, and can turn the authenticator app on again from their account page.'
    },
    'cancel-invite': {
      title: `Cancel the invite for ${user.name}?`,
      body: 'The invite link stops working and they are removed from the list. You can invite the same email again later.',
      danger: true
    },
    'end-sessions': {
      title: `Sign ${user.name} out everywhere?`,
      body: 'Every browser they are signed in on is signed out. They can sign in again straight away.'
    }
  };
  const c = confirm ? CONFIRM[confirm] : undefined;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size='sm' variant='outline' aria-label={`Actions for ${user.name}`} />}
        >
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-52'>
          <DropdownMenuItem onClick={onEdit}>Edit name or role</DropdownMenuItem>
          {user.status === 'invited' && (
            <>
              <DropdownMenuItem onClick={() => run('resend-invite')}>
                Resend invite
              </DropdownMenuItem>
              <DropdownMenuItem variant='destructive' onClick={ask('cancel-invite')}>
                Cancel invite
              </DropdownMenuItem>
            </>
          )}
          {user.status === 'active' && (
            <>
              <DropdownMenuItem onClick={() => run('send-password-reset')}>
                Send password reset
              </DropdownMenuItem>
              {user.two_factor && (
                <DropdownMenuItem onClick={ask('reset-2fa')}>
                  Reset two-step sign-in
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={ask('end-sessions')}>Sign out everywhere</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={ask('disable')}>
                Disable
              </DropdownMenuItem>
            </>
          )}
          {user.status === 'disabled' && (
            <DropdownMenuItem onClick={() => run('enable')}>Enable</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!c} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c?.title}</DialogTitle>
            <DialogDescription>{c?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={c?.danger ? 'destructive' : 'default'}
              disabled={action.isPending}
              onClick={() => confirm && run(confirm)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminsScreen() {
  const { data, isPending, error } = useAdmins();
  const { data: me } = useAdmin();
  const canManage = useCan('users.manage');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [filter, setFilter] = useState<'all' | AdminUser['status']>('all');
  const [search, setSearch] = useState('');
  const rows = (data ?? []).filter(
    (a) =>
      (filter === 'all' || a.status === filter) &&
      `${a.name} ${a.email}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          aria-label='Search users'
          placeholder='Search name or email'
          className='w-full sm:w-64'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect
          aria-label='Status'
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <NativeSelectOption value='all'>Everyone</NativeSelectOption>
          <NativeSelectOption value='active'>Active</NativeSelectOption>
          <NativeSelectOption value='invited'>Invited</NativeSelectOption>
          <NativeSelectOption value='disabled'>Disabled</NativeSelectOption>
        </NativeSelect>
        {canManage && (
          <Button className='ml-auto' onClick={() => setInviting(true)}>
            Invite user
          </Button>
        )}
      </div>
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        // Inline-size containment keeps the wide table from widening the page; it scrolls instead.
        <div className='overflow-x-auto rounded-lg border [contain:inline-size]'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Two-step sign-in</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={6}>Nobody matches.</EmptyRow>}
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/admins/${a.id}`}
                      className='font-medium hover:underline'
                    >
                      {a.name}
                    </Link>{' '}
                    {a.id === me?.id && (
                      <span className='text-muted-foreground text-xs'>(you)</span>
                    )}
                    <div className='text-muted-foreground text-xs'>{a.email}</div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/dashboard/roles/${a.role_id}`} className='hover:underline'>
                      {a.role_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                    {a.status === 'invited' && a.invited_at && (
                      <div className='text-muted-foreground mt-1 text-xs'>
                        sent {timeAgo(a.invited_at)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className='text-sm'>
                    {a.status === 'invited' ? (
                      '—'
                    ) : a.two_factor ? (
                      'On'
                    ) : (
                      <span className='text-muted-foreground'>Off</span>
                    )}
                  </TableCell>
                  <TableCell className='text-sm'>
                    {a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}
                    {a.open_sessions > 0 && (
                      <div className='text-muted-foreground text-xs'>
                        {a.open_sessions} signed-in {a.open_sessions === 1 ? 'browser' : 'browsers'}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className='text-right'>
                    {a.id === me?.id ? (
                      <Link href='/dashboard/account' className='text-sm hover:underline'>
                        My account
                      </Link>
                    ) : (
                      canManage &&
                      a.manageable && <UserActions user={a} onEdit={() => setEditing(a)} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {canManage && <InviteDialog open={inviting} onClose={() => setInviting(false)} />}
      {editing && (
        <EditUserDialog key={editing.id} user={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
