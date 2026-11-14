'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { adminApi, ApiError, errorMessage } from '@/lib/api-client';

type Step = { name: 'password' } | { name: 'code' };

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

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'me'] });
    router.replace('/dashboard/overview');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await adminApi('/auth/login', {
        method: 'POST',
        body: { email, password, ...(step.name === 'code' ? { code } : {}) }
      });
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
                  <Link
                    href='/forgot-password'
                    className='text-muted-foreground self-end text-xs hover:underline'
                  >
                    Forgot password?
                  </Link>
                </div>
              </>
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
              {busy ? 'Checking…' : 'Sign in'}
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
