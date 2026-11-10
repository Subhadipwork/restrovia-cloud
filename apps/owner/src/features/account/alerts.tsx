'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useOwner } from '@/features/auth/use-owner';
import { errorMessage, ownerApi } from '@/lib/api-client';
import { formatDay } from '@/lib/display';

type AlertPrefs = { daily_summary_email: boolean; offline_alert: boolean; email_verified: boolean };
type Switches = Omit<AlertPrefs, 'email_verified'>;

const PREFS_KEY = ['owner', 'notification-prefs'];

function AlertSwitch({
  id,
  title,
  description,
  checked,
  disabled,
  onChange
}: {
  id: keyof Switches;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <Label htmlFor={id}>{title}</Label>
        <p className='text-muted-foreground text-sm'>{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function AlertsScreen() {
  const queryClient = useQueryClient();
  const { data: owner } = useOwner();
  const { data, error, isPending } = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => ownerApi<AlertPrefs>('/me/notification-prefs')
  });
  const save = useMutation({
    mutationFn: (change: Partial<Switches>) =>
      ownerApi<AlertPrefs>('/me/notification-prefs', { method: 'PUT', body: change }),
    onSuccess: (saved) => {
      queryClient.setQueryData(PREFS_KEY, saved);
      toast.success('Alerts saved.');
    },
    onError: (err) => toast.error(errorMessage(err))
  });
  const sample = useMutation({
    mutationFn: () =>
      ownerApi<{ store: string; day: string }>('/me/notification-prefs/sample', {
        method: 'POST',
        body: {}
      }),
    onSuccess: (sent) =>
      toast.success(`Sent ${sent.store}’s summary for ${formatDay(sent.day)} to your email.`),
    onError: (err) => toast.error(errorMessage(err))
  });

  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data) return <Skeleton className='h-48' role='status' aria-label='Loading' />;

  return (
    <div className='flex max-w-2xl flex-col gap-4'>
      {!data.email_verified && (
        <div
          role='status'
          className='rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm'
        >
          Alerts go only to a confirmed email. Open the link Restrovia emailed you, or change your
          email on the Profile page to get a new link.
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Email alerts</CardTitle>
          <CardDescription>
            Sent to {owner?.email ?? 'your email'} for every café linked to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-6'>
          <AlertSwitch
            id='daily_summary_email'
            title='Daily summary'
            description='Sales, bills, top items, cancelled orders and discounts, half an hour after each café’s business day ends.'
            checked={data.daily_summary_email}
            disabled={save.isPending}
            onChange={(checked) => save.mutate({ daily_summary_email: checked })}
          />
          <AlertSwitch
            id='offline_alert'
            title='POS offline'
            description='One email when a café’s POS has been out of touch for an hour at a time it is usually selling. Nights and closed days don’t count.'
            checked={data.offline_alert}
            disabled={save.isPending}
            onChange={(checked) => save.mutate({ offline_alert: checked })}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>See what the summary looks like</CardTitle>
          <CardDescription>
            Sends the newest day with sales to your email now, whether or not the switch is on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant='outline' disabled={sample.isPending} onClick={() => sample.mutate()}>
            {sample.isPending ? 'Sending…' : 'Send me a sample'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
