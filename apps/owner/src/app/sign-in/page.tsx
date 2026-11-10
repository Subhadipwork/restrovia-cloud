'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { AuthCard, FormError, PasswordInput } from '@/features/auth/auth-card';
import { OWNER_QUERY_KEY } from '@/features/auth/use-owner';
import { ownerApi, ApiError, errorMessage } from '@/lib/api-client';

type LoginResponse = { status: 'ok' } | { status: '2fa_required'; challenge_token: string };
type Step = { name: 'password' } | { name: 'code'; challenge: string; recovery: boolean };

const NOTICES: Record<string, string> = {
  verified: 'Your email is confirmed. Sign in to continue.',
  reset: 'Your password is changed. Sign in with the new one.'
};

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = NOTICES[params.get('notice') ?? ''];

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: OWNER_QUERY_KEY });
    router.replace('/dashboard/overview');
  };

  const signIn = async () => {
    const res = await ownerApi<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    if (res.status === '2fa_required') {
      setStep({ name: 'code', challenge: res.challenge_token, recovery: false });
      return;
    }
    await finish();
  };

  const confirm = async (value: string, s: Extract<Step, { name: 'code' }>) => {
    await ownerApi('/auth/2fa', {
      method: 'POST',
      body: {
        challenge_token: s.challenge,
        ...(s.recovery ? { recovery_code: value } : { code: value })
      }
    });
    await finish();
  };

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setCode('');
      if (err instanceof ApiError && err.body.error === 'challenge_expired') {
        setStep({ name: 'password' });
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = step;
    void run(() => (s.name === 'password' ? signIn() : confirm(code, s)));
  };

  const onCodeChange = (value: string) => {
    setCode(value);
    if (step.name === 'code' && !step.recovery && value.length === 6 && !busy) {
      const s = step;
      void run(() => confirm(value, s));
    }
  };

  return (
    <AuthCard
      title={step.name === 'password' ? 'Sign in' : 'Two-factor authentication'}
      description={
        step.name === 'password'
          ? 'See your café’s sales and orders from anywhere.'
          : step.recovery
            ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication.'
            : 'Enter the 6-digit code from your authenticator app.'
      }
      footer={
        step.name === 'password' &&
        'No account yet? Restrovia support sets one up for your café and emails you a link.'
      }
    >
      <form onSubmit={submit} className='flex flex-col gap-4'>
        {notice && step.name === 'password' && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {step.name === 'password' ? (
          <>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='email'>Email</Label>
              <Input
                id='email'
                type='email'
                autoComplete='email'
                inputMode='email'
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='password'>Password</Label>
                <Link
                  href='/forgot-password'
                  className='text-muted-foreground text-sm underline-offset-4 hover:underline'
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id='password'
                autoComplete='current-password'
                value={password}
                onChange={setPassword}
              />
            </div>
          </>
        ) : step.recovery ? (
          <div className='flex flex-col gap-2'>
            <Label htmlFor='recovery'>Recovery code</Label>
            <Input
              id='recovery'
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
              placeholder='xxxx-xxxx'
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            <Label htmlFor='code'>Code</Label>
            <InputOTP
              id='code'
              maxLength={6}
              value={code}
              onChange={onCodeChange}
              inputMode='numeric'
              autoComplete='one-time-code'
              autoFocus
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className='size-11 text-lg' />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
        )}

        <FormError message={error} />

        <Button
          type='submit'
          size='lg'
          disabled={busy || (step.name === 'code' && !step.recovery && code.length !== 6)}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        {step.name === 'code' && (
          <div className='flex flex-col gap-1'>
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                setStep({ ...step, recovery: !step.recovery });
                setCode('');
                setError('');
              }}
            >
              {step.recovery ? 'Use the authenticator app' : 'Use a recovery code'}
            </Button>
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
          </div>
        )}
      </form>
    </AuthCard>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
