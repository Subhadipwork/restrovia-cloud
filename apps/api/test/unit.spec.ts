import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/crypto/crypto.service.js';
import { businessDate } from '../src/sales/business-date.js';
import { validateEnv } from '../src/config/env.js';

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
