import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Encryption at rest, password hashing and token hashing. Stored layout for encrypted values: iv | tag | ciphertext. */
@Injectable()
export class CryptoService {
  private readonly masterKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.masterKey = Buffer.from(config.get('MASTER_KEY', { infer: true }), 'base64');
  }

  encrypt(plain: string | Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(stored: Buffer): Buffer {
    const iv = stored.subarray(0, IV_BYTES);
    const tag = stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(stored.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  }

  sha256(value: string | Buffer): Buffer {
    return createHash('sha256').update(value).digest();
  }

  /** URL-safe random token, used for API keys and session cookies. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Zero-padded numeric code, used for OTPs and pairing codes. */
  randomDigits(length: number): string {
    const max = 10 ** length;
    return (randomBytes(6).readUIntBE(0, 6) % max).toString().padStart(length, '0');
  }

  safeEqual(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b);
  }

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
