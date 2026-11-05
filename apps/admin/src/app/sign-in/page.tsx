'use client';

import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { adminApi, ApiError, errorMessage } from '@/lib/api-client';

type LoginResponse =
  | { status: 'ok' }
  | { status: 'setup_required'; setup_token: string; secret: string; otpauth_url: string };

type Step =
  | { name: 'password' }
  | { name: 'code' }
  | { name: 'setup'; setupToken: string; secret: string; otpauthUrl: string };

function CodeInput({
  value,
  onChange,
  id
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <InputOTP id={id} maxLength={6} value={value} onChange={onChange} inputMode='numeric' autoFocus>
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (step.name === 'setup')
      QRCode.toDataURL(step.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [step]);

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'me'] });
    router.replace('/dashboard/overview');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (step.name === 'setup') {
        await adminApi('/auth/setup-2fa', {
          method: 'POST',
          body: { setup_token: step.setupToken, code }
        });
        return await finish();
      }
      const res = await adminApi<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(step.name === 'code' ? { code } : {}) }
      });
      if (res.status === 'setup_required') {
        setCode('');
        setStep({
          name: 'setup',
          setupToken: res.setup_token,
          secret: res.secret,
          otpauthUrl: res.otpauth_url
        });
        return;
      }
      await finish();
    } catch (err) {
      if (err instanceof ApiError && err.body.error === 'code_required') {
        setStep({ name: 'code' });
        return;
      }
      setCode('');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const needsCode = step.name !== 'password';

  return (
    <main className='bg-muted/40 flex min-h-svh items-center justify-center p-4'>
      <Card className='w-full max-w-sm'>
        <CardHeader>
          <CardTitle className='text-xl'>Restrovia Admin</CardTitle>
          <CardDescription>
            {step.name === 'password' && 'Sign in with your Restrovia team account.'}
            {step.name === 'code' && 'Enter the 6-digit code from your authenticator app.'}
            {step.name === 'setup' && 'Set up two-step sign-in. It is required for every admin.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className='flex flex-col gap-4'>
            {step.name === 'password' && (
              <>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='email'>Email</Label>
                  <Input
                    id='email'
                    type='email'
                    autoComplete='username'
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='password'>Password</Label>
                  <Input
                    id='password'
                    type='password'
                    autoComplete='current-password'
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </>
            )}

            {step.name === 'setup' && (
              <ol className='text-muted-foreground flex list-decimal flex-col gap-3 pl-5 text-sm'>
                <li>
                  Open an authenticator app (Google Authenticator, Microsoft Authenticator,
                  1Password…).
                </li>
                <li>
                  Scan this code, or enter the key by hand.
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
                    <code className='bg-muted rounded px-2 py-1 text-xs break-all text-foreground'>
                      {step.secret}
                    </code>
                  </div>
                </li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
            )}

            {needsCode && (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='code'>Code</Label>
                <CodeInput id='code' value={code} onChange={setCode} />
              </div>
            )}

            {error && (
              <Alert variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type='submit' disabled={busy || (needsCode && code.length !== 6)}>
              {busy ? 'Checking…' : step.name === 'setup' ? 'Turn on two-step sign-in' : 'Sign in'}
            </Button>
            {needsCode && (
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setStep({ name: 'password' });
                  setCode('');
                  setError('');
                }}
              >
                Use a different account
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
