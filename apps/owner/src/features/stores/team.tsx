'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, ownerApi } from '@/lib/api-client';
import { formatDateTime, timeAgo } from '@/lib/display';
import { useStores } from './api';

type Member = {
  owner_id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager';
  added_at: string;
  last_sign_in_at: string | null;
  set_up: boolean;
  you: boolean;
};
type Invite = {
  id: string;
  email: string;
  role: 'manager';
  invited_by: string;
  expires_at: string;
  expired: boolean;
  sent_at: string;
  can_resend: boolean;
};
type Team = { members: Member[]; invites: Invite[] };

const useTeam = (storeId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'team'],
    queryFn: () => ownerApi<Team>(`/stores/${storeId}/team`),
    enabled
  });

function InviteDialog({
  storeId,
  open,
  onOpenChange
}: {
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const invite = useMutation({
    mutationFn: () =>
      ownerApi<Team>(`/stores/${storeId}/team/invites`, { method: 'POST', body: { email } }),
    onSuccess: (team) => {
      queryClient.setQueryData(['owner', 'store', storeId, 'team'], team);
      toast.success(`Invite sent to ${email}.`);
      setEmail('');
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err))
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            invite.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite a manager</DialogTitle>
            <DialogDescription>
              Managers see this café’s sales, orders and reports and can edit the menu (price
              changes over 25% need an owner). They can’t invite others. The link in the email works
              for 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='invite-email'>Email</Label>
            <Input
              id='invite-email'
              type='email'
              inputMode='email'
              autoComplete='off'
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && (
              <p role='alert' className='text-destructive text-sm'>
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={invite.isPending || !email.includes('@')}>
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  storeId,
  storeName,
  member,
  onClose
}: {
  storeId: string;
  storeName: string;
  member: Member | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (m: Member) =>
      ownerApi<Team>(`/stores/${storeId}/team/members/${m.owner_id}`, { method: 'DELETE' }),
    onSuccess: (team, m) => {
      queryClient.setQueryData(['owner', 'store', storeId, 'team'], team);
      toast.success(`${m.name || m.email} no longer has access to ${storeName}.`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err))
  });
  return (
    <AlertDialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member?.name || member?.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            They stop seeing {storeName} straight away and get an email saying so. You can invite
            them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            disabled={remove.isPending}
            onClick={() => member && remove.mutate(member)}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Invites({ storeId, invites }: { storeId: string; invites: Invite[] }) {
  const queryClient = useQueryClient();
  const done = (team: Team) => queryClient.setQueryData(['owner', 'store', storeId, 'team'], team);
  const resend = useMutation({
    mutationFn: (i: Invite) =>
      ownerApi<Team>(`/stores/${storeId}/team/invites/${i.id}/resend`, { method: 'POST' }),
    onSuccess: (team, i) => {
      done(team);
      toast.success(`A new link was sent to ${i.email}. The old one no longer works.`);
    },
    onError: (err) => toast.error(errorMessage(err))
  });
  const cancel = useMutation({
    mutationFn: (i: Invite) =>
      ownerApi<Team>(`/stores/${storeId}/team/invites/${i.id}`, { method: 'DELETE' }),
    onSuccess: (team, i) => {
      done(team);
      toast.success(`The invite to ${i.email} is cancelled.`);
    },
    onError: (err) => toast.error(errorMessage(err))
  });

  if (invites.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiting to accept</CardTitle>
        <CardDescription>Invites that haven’t been accepted yet.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y'>
          {invites.map((i) => (
            <li key={i.id} className='flex flex-wrap items-center gap-x-4 gap-y-2 py-3'>
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>{i.email}</p>
                <p className='text-muted-foreground text-xs'>
                  Invited by {i.invited_by} · sent {timeAgo(i.sent_at)} ·{' '}
                  {i.expired ? (
                    <span className='text-amber-600 dark:text-amber-400'>link expired</span>
                  ) : (
                    `link works until ${formatDateTime(i.expires_at)}`
                  )}
                </p>
              </div>
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={!i.can_resend || resend.isPending}
                  title={i.can_resend ? undefined : 'This invite was sent too many times.'}
                  onClick={() => resend.mutate(i)}
                >
                  Send again
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(i)}
                >
                  Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function TeamScreen({ storeId }: { storeId: string }) {
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const isOwner = store?.role === 'owner';
  const { data: team, error, isPending } = useTeam(storeId, isOwner);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  if (store && !isOwner) {
    return (
      <p className='text-muted-foreground text-sm'>
        Only the café’s owners can see and change its team.
      </p>
    );
  }
  if (error) {
    return (
      <p role='alert' className='text-destructive text-sm'>
        {errorMessage(error)}
      </p>
    );
  }
  if (isPending || !team || !store) {
    return <Skeleton className='h-64' role='status' aria-label='Loading team' />;
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex justify-end'>
        <Button onClick={() => setInviting(true)}>Invite a manager</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>People with access</CardTitle>
          <CardDescription>
            Owners and managers see the same pages. Only owners manage the team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className='divide-y'>
            {team.members.map((m) => (
              <li key={m.owner_id} className='flex flex-wrap items-center gap-x-4 gap-y-2 py-3'>
                <div className='min-w-0 flex-1'>
                  <p className='flex items-center gap-2'>
                    <span className='truncate font-medium'>{m.name || m.email}</span>
                    <Badge variant={m.role === 'owner' ? 'default' : 'outline'}>
                      {m.role === 'owner' ? 'Owner' : 'Manager'}
                    </Badge>
                    {m.you && <span className='text-muted-foreground text-xs'>You</span>}
                  </p>
                  <p className='text-muted-foreground truncate text-xs'>
                    {m.name ? `${m.email} · ` : ''}
                    {m.set_up
                      ? m.last_sign_in_at
                        ? `last signed in ${timeAgo(m.last_sign_in_at)}`
                        : 'hasn’t signed in yet'
                      : 'hasn’t chosen a password yet'}
                  </p>
                </div>
                {m.role === 'manager' && (
                  <Button variant='ghost' size='sm' onClick={() => setRemoving(m)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Invites storeId={storeId} invites={team.invites} />

      <p className='text-muted-foreground text-xs'>
        To add another owner or remove one, contact Restrovia support. Making a new code with
        “revoke” in the POS cloud settings removes every owner and manager from this café.
      </p>

      <InviteDialog storeId={storeId} open={inviting} onOpenChange={setInviting} />
      <RemoveDialog
        storeId={storeId}
        storeName={store.name}
        member={removing}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
