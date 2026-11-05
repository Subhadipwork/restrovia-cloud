import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

const masterKey = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'MASTER_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)',
});

/** Ed25519 private key, PKCS#8 DER, base64. The matching public key is built into Restrovia POS. */
const licenceKey = z.string().refine((value) => {
  try {
    return (
      createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })
        .asymmetricKeyType === 'ed25519'
    );
  } catch {
    return false;
  }
}, 'LICENCE_SIGNING_KEY must be an Ed25519 private key (PKCS#8 DER, base64)');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  MASTER_KEY: masterKey,
  /** Without it the licence endpoint answers 503, and POS installs with licensing on can't renew. */
  LICENCE_SIGNING_KEY: z.preprocess((v) => (v === '' ? undefined : v), licenceKey.optional()),
  LICENCE_KEY_ID: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default('k1'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
