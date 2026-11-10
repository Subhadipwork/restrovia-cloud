'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** No 0/o or 1/i/l: the owner usually reads it off a phone screen or hears it on a call. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error('Couldn’t copy. Select the text and copy it by hand.');
  }
}

/**
 * A password the admin gives the owner by phone or in person. Shown in plain text so it can be
 * read out; the owner replaces it at their first sign-in.
 */
export function AdminPasswordField({
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
      <Label htmlFor={id}>Password</Label>
      <div className='flex gap-2'>
        <Input
          id={id}
          required
          minLength={8}
          maxLength={128}
          autoComplete='off'
          spellCheck={false}
          className='font-mono'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type='button' variant='outline' onClick={() => onChange(generatePassword())}>
          Generate
        </Button>
      </div>
      <p className='text-muted-foreground text-xs'>
        At least 8 characters. Tell the owner by phone or in person, not by email. They choose their
        own when they first sign in.
      </p>
    </div>
  );
}
