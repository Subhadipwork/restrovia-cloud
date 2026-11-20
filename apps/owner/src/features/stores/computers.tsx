'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { errorMessage, ownerApi } from '@/lib/api-client';
import { timeAgo } from '@/lib/display';

const CODE_LENGTH = 8;
const PLATFORMS: Record<string, string> = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };

type Computer = {
  id: string;
  name: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  online: boolean;
};

type Preview = {
  computer: { id: string; name: string | null; platform: string | null; app_version: string | null };
  from_store: { name: string; code: string } | null;
  already_in_this_store: boolean;
  can_retire: Computer[];
  suggested_retire_id: string | null;
};

const describe = (c: { name: string | null; platform: string | null }) =>
  [c.name || 'POS computer', PLATFORMS[c.platform ?? ''] ?? c.platform].filter(Boolean).join(' · ');

/**
 * Moves a POS to this café with the 8-digit code it shows: a new computer, a reinstall, or a
 * backup restored on another computer. The café keeps its trial or plan.
 */
export function LinkComputerDialog({
  storeId,
  open,
  onOpenChange
}: {
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [retire, setRetire] = useState('none');
  const [error, setError] = useState('');

  const reset = () => {
    setCode('');
    setPreview(null);
    setRetire('none');
    setError('');
  };

  const check = useMutation({
    mutationFn: (value: string) =>
      ownerApi<Preview>(`/stores/${storeId}/devices/link/preview`, {
        method: 'POST',
        body: { code: value }
      }),
    onSuccess: (p) => {
      setPreview(p);
      setRetire(p.suggested_retire_id ?? 'none');
    },
    onError: (err) => {
      setCode('');
      setError(errorMessage(err));
    }
  });

  const link = useMutation({
    mutationFn: () =>
      ownerApi(`/stores/${storeId}/devices/link`, {
        method: 'POST',
        body: { code, retire_device_id: retire === 'none' ? null : retire }
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'store', storeId] });
      toast.success('Done. The POS keeps working on this café’s plan within a minute.');
      reset();
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err))
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a computer</DialogTitle>
          <DialogDescription>
            On the new computer, open Restrovia POS and choose <b>Link to my store</b> (on the
            banner, or in Settings → Restrovia subscription). Enter the 8 digits it shows within 15
            minutes.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <form
            className='flex flex-col gap-2'
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === CODE_LENGTH) check.mutate(code);
            }}
          >
            <Label htmlFor='computer-code'>Code from the POS</Label>
            <InputOTP
              id='computer-code'
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(value) => {
                setError('');
                setCode(value);
                if (value.length === CODE_LENGTH && !check.isPending) check.mutate(value);
              }}
              inputMode='numeric'
              autoComplete='off'
              autoFocus
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, i) => (
                  <InputOTPSlot key={i} index={i} className='size-10 text-lg' />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <p role='alert' className='text-destructive text-sm'>
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type='submit' disabled={check.isPending || code.length !== CODE_LENGTH}>
                {check.isPending ? 'Checking…' : 'Continue'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className='flex flex-col gap-4 text-sm'>
            <div className='rounded-md border p-3'>
              <p className='font-medium'>{describe(preview.computer)}</p>
              <p className='text-muted-foreground'>
                {preview.already_in_this_store
                  ? 'Already this café’s POS, now on a different computer. It moves to this computer.'
                  : preview.from_store
                    ? `Now set up as “${preview.from_store.name || 'a new café'}” (${preview.from_store.code}). It joins this café; that empty setup is removed.`
                    : 'It joins this café.'}
              </p>
            </div>
            {preview.can_retire.length > 0 && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium'>Switch off a computer this one replaces</p>
                <RadioGroup
                  aria-label='Computer to switch off'
                  value={retire}
                  onValueChange={(v) => setRetire(String(v))}
                >
                  {preview.can_retire.map((c) => (
                    <div key={c.id} className='flex items-center gap-2'>
                      <RadioGroupItem id={`retire-${c.id}`} value={c.id} />
                      <Label htmlFor={`retire-${c.id}`} className='font-normal'>
                        {describe(c)}
                        <span className='text-muted-foreground text-xs'>
                          seen {timeAgo(c.last_seen_at)}
                        </span>
                      </Label>
                    </div>
                  ))}
                  <div className='flex items-center gap-2'>
                    <RadioGroupItem id='retire-none' value='none' />
                    <Label htmlFor='retire-none' className='font-normal'>
                      Keep all computers
                    </Label>
                  </div>
                </RadioGroup>
                <p className='text-muted-foreground text-xs'>
                  A computer you switch off stops billing at its next check, within a minute
                  when it is online.
                </p>
              </div>
            )}
            {error && (
              <p role='alert' className='text-destructive'>
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant='outline' onClick={reset}>
                Back
              </Button>
              <Button disabled={link.isPending} onClick={() => link.mutate()}>
                {link.isPending ? 'Linking…' : 'Link computer'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Switches off a lost, stolen or replaced POS computer after a second click. */
export function RetireComputerButton({ storeId, deviceId }: { storeId: string; deviceId: string }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const retire = useMutation({
    mutationFn: () =>
      ownerApi(`/stores/${storeId}/devices/${deviceId}/retire`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'store', storeId] });
      toast.success('Computer switched off.');
    },
    onError: (err) => toast.error(errorMessage(err))
  });
  return (
    <Button
      size='sm'
      variant={confirm ? 'destructive' : 'ghost'}
      disabled={retire.isPending}
      onBlur={() => setConfirm(false)}
      onClick={() => (confirm ? retire.mutate() : setConfirm(true))}
    >
      {confirm ? 'Confirm switch off' : 'Switch off'}
    </Button>
  );
}
