'use client';

import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** The centred card every signed-out screen uses (sign-in, set password, password reset). */
export function AuthCard({
  title,
  description,
  children,
  footer
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className='bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-4 p-4'>
      <div className='flex items-center gap-2 font-semibold'>
        <span className='bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm'>
          R
        </span>
        Restrovia
      </div>
      <Card className='w-full max-w-sm'>
        <CardHeader>
          <CardTitle className='text-xl'>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer && <div className='text-muted-foreground text-center text-sm'>{footer}</div>}
    </main>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Alert variant='destructive'>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Password field with a show/hide button; long passwords are hard to type on a phone unseen. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className='relative'>
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        maxLength={128}
        className='pr-11'
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='absolute top-1/2 right-0.5 size-8 -translate-y-1/2'
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? <IconEyeOff className='size-4' /> : <IconEye className='size-4' />}
      </Button>
    </div>
  );
}

export function NewPasswordHint() {
  return (
    <p className='text-muted-foreground text-xs'>
      At least 8 characters. A short sentence is easy to remember and hard to guess.
    </p>
  );
}
