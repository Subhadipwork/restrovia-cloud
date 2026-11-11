'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
import { errorMessage, ownerApi } from '@/lib/api-client';

type Linked = { store_id: string; name: string; was_manager: boolean };

/** Links a café with the 6-digit code from its Restrovia POS, making the person its owner. */
export function AddCafeDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const link = useMutation({
    mutationFn: (value: string) =>
      ownerApi<Linked>('/stores/link', { method: 'POST', body: { code: value } }),
    onSuccess: async (linked) => {
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
      toast.success(
        linked.was_manager
          ? `You’re now an owner of ${linked.name}.`
          : `${linked.name} is added to your account.`
      );
      setCode('');
      onOpenChange(false);
      router.push(`/dashboard/${linked.store_id}`);
    },
    onError: (err) => {
      setCode('');
      setError(errorMessage(err));
    }
  });

  const send = (value: string) => {
    setError('');
    link.mutate(value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError('');
        setCode('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) send(code);
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a café</DialogTitle>
            <DialogDescription>
              On the café’s computer, open Restrovia POS → Settings, find the RevFlo card and press
              Generate Pairing Code. Enter the 6 digits here within 15 minutes. You become an owner
              of that café.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='pairing-code'>Code from the POS</Label>
            <InputOTP
              id='pairing-code'
              maxLength={6}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6 && !link.isPending) send(value);
              }}
              inputMode='numeric'
              autoComplete='off'
              autoFocus
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className='size-11 text-lg' />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <p role='alert' className='text-destructive text-sm'>
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type='submit' disabled={link.isPending || code.length !== 6}>
              {link.isPending ? 'Adding…' : 'Add café'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
