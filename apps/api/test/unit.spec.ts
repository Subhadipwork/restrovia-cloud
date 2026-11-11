import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { businessDate } from '../src/sales/business-date.js';
import { validateEnv } from '../src/config/env.js';
import { EmailService } from '../src/email/email.service.js';
import { OWNER_INVITE_TEMPLATE, ownerEmails } from '../src/owner/owner-emails.js';

const makeCrypto = (key = randomBytes(32).toString('base64')) =>
  new CryptoService({ get: () => key } as unknown as ConfigService<never, true>);

describe('CryptoService', () => {
  const crypto = makeCrypto();

  it('decrypts what it encrypted', () => {
    const stored = crypto.encrypt('api-key-123');
    expect(stored.toString()).not.toContain('api-key-123');
    expect(crypto.decrypt(stored).toString()).toBe('api-key-123');
  });

  it('uses a fresh IV each time', () => {
    expect(crypto.encrypt('same').equals(crypto.encrypt('same'))).toBe(false);
  });

  it('rejects tampered ciphertext', () => {
    const stored = crypto.encrypt('secret');
    stored[stored.length - 1] ^= 0xff;
    expect(() => crypto.decrypt(stored)).toThrow();
  });

  it('rejects a different master key', () => {
    const stored = crypto.encrypt('secret');
    expect(() => makeCrypto().decrypt(stored)).toThrow();
  });

  it('hashes and verifies passwords with argon2id', async () => {
    const hash = await crypto.hashPassword('correct horse');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(crypto.verifyPassword(hash, 'correct horse')).resolves.toBe(true);
    await expect(crypto.verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('makes numeric codes of the requested length', () => {
    for (let i = 0; i < 50; i++) expect(crypto.randomDigits(6)).toMatch(/^\d{6}$/);
  });

  it('compares buffers safely, including different lengths', () => {
    expect(crypto.safeEqual(Buffer.from('ab'), Buffer.from('ab'))).toBe(true);
    expect(crypto.safeEqual(Buffer.from('ab'), Buffer.from('abc'))).toBe(false);
  });
});

describe('businessDate', () => {
  it('counts 1:00 am IST on the IST date, not the previous UTC date', () => {
    // 2026-11-03T19:30Z is 2026-11-04 01:00 in India.
    expect(businessDate(new Date('2026-11-03T19:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-04');
  });

  it('moves early-morning sales to the previous day when the day starts later', () => {
    const at = new Date('2026-11-03T21:00:00Z'); // 02:30 IST on the 4th
    expect(businessDate(at, 'Asia/Kolkata', '04:00')).toBe('2026-11-03');
    expect(businessDate(at, 'Asia/Kolkata', '02:00:00')).toBe('2026-11-04');
  });

  it('uses the store timezone', () => {
    const at = new Date('2026-11-04T02:00:00Z');
    expect(businessDate(at, 'America/New_York')).toBe('2026-11-03');
    expect(businessDate(at, 'Asia/Kolkata')).toBe('2026-11-04');
  });
});

describe('validateEnv', () => {
  const good = { DATABASE_URL: 'postgres://x', MASTER_KEY: randomBytes(32).toString('base64') };

  it('accepts a valid environment and fills defaults', () => {
    expect(validateEnv(good)).toMatchObject({ PORT: 4000, NODE_ENV: 'development' });
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => validateEnv({ ...good, MASTER_KEY: 'c2hvcnQ=' })).toThrow(/MASTER_KEY/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({ MASTER_KEY: good.MASTER_KEY })).toThrow(/DATABASE_URL/);
  });
});

describe('EmailService with resend', () => {
  const settings: Record<string, string> = {
    EMAIL_PROVIDER: 'resend',
    EMAIL_API_KEY: 're_test',
    EMAIL_FROM: 'Restrovia <no-reply@example.com>',
    NODE_ENV: 'test',
  };
  const email = new EmailService({
    get: (key: string) => settings[key],
  } as unknown as ConfigService<never, true>);
  const message = { to: 'owner@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' };

  afterEach(() => vi.restoreAllMocks());

  it('posts the message to the provider', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    await email.send(message);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      from: 'Restrovia <no-reply@example.com>',
      to: ['owner@example.com'],
    });
  });

  it('names the provider’s reason when it refuses the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"The example.com domain is not verified."}', { status: 403 }),
    );
    await expect(email.send(message)).rejects.toThrow(/403: .*domain is not verified/);
  });
});

describe('EmailService with a stored template', () => {
  const settings: Record<string, string> = {
    EMAIL_PROVIDER: 'resend',
    EMAIL_API_KEY: 're_test',
    EMAIL_FROM: 'Restrovia <no-reply@example.com>',
    NODE_ENV: 'test',
  };
  const email = new EmailService({
    get: (key: string) => settings[key],
  } as unknown as ConfigService<never, true>);
  const invite = ownerEmails.invite('owner@example.com', 'Asha', 'Tea House', 'https://x.test/i/1');
  const bodies = (fetch: { mock: { calls: unknown[][] } }) =>
    fetch.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));

  afterEach(() => vi.restoreAllMocks());

  it('sends the owner invite through its template without inline content', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    await email.send(invite);
    const [body] = bodies(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      from: 'Restrovia <no-reply@example.com>',
      to: ['owner@example.com'],
      subject: 'Your Restrovia account is ready',
      template: {
        id: OWNER_INVITE_TEMPLATE,
        variables: { OWNER_NAME: 'Asha', STORE_NAME: 'Tea House', INVITE_URL: 'https://x.test/i/1' },
      },
    });
  });

  it('falls back to the built-in email when the template is refused', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"message":"Template not found"}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"id":"2"}', { status: 200 }));
    await email.send(invite);
    const [, fallback] = bodies(fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fallback.template).toBeUndefined();
    expect(fallback.html).toContain('https://x.test/i/1');
    expect(fallback.text).toContain('Choose your password: https://x.test/i/1');
  });

  it('does not retry when the provider refuses the sender', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"message":"domain is not verified"}', { status: 403 }));
    await expect(email.send(invite)).rejects.toThrow(/403: .*domain is not verified/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('greets an unnamed owner without leaving the variable empty', () => {
    expect(ownerEmails.invite('o@example.com', '', 'Tea House', 'u').template?.variables).toMatchObject({
      OWNER_NAME: 'there',
    });
  });
});
