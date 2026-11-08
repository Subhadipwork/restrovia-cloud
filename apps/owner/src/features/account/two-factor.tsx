'use client';

import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { FormError, PasswordInput } from '@/features/auth/auth-card';
import { ownerApi, errorMessage } from '@/lib/api-client';

/** One field for either a 6-digit authenticator code or a recovery code. */
export function SecondFactorInput({
  id,
  value,
  onChange
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={id}>Code from your authenticator app, or a recovery code</Label>
      <Input
        id={id}
        autoComplete='one-time-code'
        autoCapitalize='none'
        spellCheck={false}
        required
        maxLength={20}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function secondFactorBody(value: string) {
  const v = value.trim();
  return /^\d{6}$/.test(v) ? { code: v } : { recovery_code: v };
}

/** Shown once: the owner must copy or download them before going on. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Restrovia recovery codes. Each works once.\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Recovery codes copied.');
    } catch {
      toast.error('Couldn’t copy. Select the codes and copy them by hand.');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'restrovia-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-sm'>
        If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe
        — they won’t be shown again.
      </p>
      <ul className='bg-muted grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-4 font-mono text-sm select-all'>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className='flex flex-wrap gap-2'>
        <Button type='button' variant='outline' onClick={copy}>
          Copy
        </Button>
        <Button type='button' variant='outline' onClick={download}>
          Download
        </Button>
      </div>
      <Label className='flex items-center gap-2 font-normal'>
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />I saved these
        codes
      </Label>
      <DialogFooter>
        <Button type='button' disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

type Setup = { secret: string; otpauth_url: string; setup_token: string };

export function TurnOnDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPassword('');
    setSetup(null);
    setQr('');
    setCode('');
    setCodes(null);
    setError('');
    onClose();
  };

  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauth_url, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setCode('');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await ownerApi<Setup>('/me/2fa/setup', { method: 'POST', body: { password } }));
      setPassword('');
    });
  };

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    void run(async () => {
      const res = await ownerApi<{ recovery_codes: string[] }>('/me/2fa/enable', {
        method: 'POST',
        body: { setup_token: setup.setup_token, code }
      });
      setCodes(res.recovery_codes);
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
    });
  };

  return (
    // Closing before the codes are saved would lose them, so then only Done closes it.
    <Dialog open={open} onOpenChange={(o) => !o && !codes && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {codes ? 'Save your recovery codes' : 'Turn on two-factor authentication'}
          </DialogTitle>
          {!codes && (
            <DialogDescription>
              After this, signing in needs your password and a code from an authenticator app on
              your phone.
            </DialogDescription>
          )}
        </DialogHeader>

        {codes ? (
          <RecoveryCodes
            codes={codes}
            onDone={() => {
              toast.success('Two-factor authentication is on. Other devices were signed out.');
              close();
            }}
          />
        ) : !setup ? (
          <form onSubmit={start} className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='tfa-password'>Enter your password to continue</Label>
              <PasswordInput
                id='tfa-password'
                autoComplete='current-password'
                value={password}
                onChange={setPassword}
              />
            </div>
            <FormError message={error} />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={close}>
                Cancel
              </Button>
              <Button type='submit' disabled={busy}>
                {busy ? 'Checking…' : 'Continue'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={confirm} className='flex flex-col gap-4'>
            <ol className='text-muted-foreground flex list-decimal flex-col gap-3 pl-5 text-sm'>
              <li>
                Install an authenticator app: Google Authenticator, Microsoft Authenticator or
                Authy.
              </li>
              <li>
                In the app, add an account and scan this code. On this phone, enter the key by hand
                instead.
                <div className='mt-2 flex flex-col items-start gap-2'>
                  {qr && (
                    <Image
                      src={qr}
                      alt='QR code for your authenticator app'
                      width={160}
                      height={160}
                      unoptimized
                      className='rounded-md border bg-white'
                    />
                  )}
                  <code className='bg-muted text-foreground rounded px-2 py-1 text-xs break-all'>
                    {setup.secret}
                  </code>
                </div>
              </li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              inputMode='numeric'
              autoComplete='one-time-code'
              aria-label='6-digit code'
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className='size-11 text-lg' />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <FormError message={error} />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={close}>
                Cancel
              </Button>
              <Button type='submit' disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Turn on'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Turning 2FA off, or making new recovery codes: both need the password and a code. */
export function ConfirmDialog({
  mode,
  onClose
}: {
  mode: 'disable' | 'new-codes' | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPassword('');
    setFactor('');
    setCodes(null);
    setError('');
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { password, ...secondFactorBody(factor) };
      if (mode === 'disable') {
        await ownerApi('/me/2fa/disable', { method: 'POST', body });
        toast.success('Two-factor authentication is off.');
        close();
      } else {
        const res = await ownerApi<{ recovery_codes: string[] }>('/me/2fa/recovery-codes', {
          method: 'POST',
          body
        });
        setCodes(res.recovery_codes);
      }
      await queryClient.invalidateQueries({ queryKey: ['owner'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !codes && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'disable'
              ? 'Turn off two-factor authentication'
              : codes
                ? 'Save your new recovery codes'
                : 'Make new recovery codes'}
          </DialogTitle>
          {!codes && (
            <DialogDescription>
              {mode === 'disable'
                ? 'Signing in will need only your password. Other devices will be signed out.'
                : 'Your old recovery codes stop working.'}
            </DialogDescription>
          )}
        </DialogHeader>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={close} />
        ) : (
          <form onSubmit={submit} className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='confirm-password'>Password</Label>
              <PasswordInput
                id='confirm-password'
                autoComplete='current-password'
                value={password}
                onChange={setPassword}
              />
            </div>
            <SecondFactorInput id='confirm-code' value={factor} onChange={setFactor} />
            <FormError message={error} />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={close}>
                Cancel
              </Button>
              <Button
                type='submit'
                variant={mode === 'disable' ? 'destructive' : 'default'}
                disabled={busy}
              >
                {busy ? 'Checking…' : mode === 'disable' ? 'Turn off' : 'Make new codes'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
