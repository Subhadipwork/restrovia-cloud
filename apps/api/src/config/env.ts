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
  /** Base of the links in owner emails (verify email, reset password). */
  OWNER_APP_URL: z.url().default('http://localhost:3200'),
  /** Base of the links in admin emails (invites, password resets). */
  ADMIN_APP_URL: z.url().default('http://localhost:3100'),
  /** `outbox` keeps emails in memory (development and tests); production needs a real provider. */
  EMAIL_PROVIDER: z.enum(['outbox', 'resend']).default('outbox'),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(3).default('Restrovia <no-reply@restrovia.in>'),
});

export type Env = z.infer<typeof envSchema>;

const checkedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.EMAIL_PROVIDER !== 'outbox' && !env.EMAIL_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_API_KEY'],
      message: 'required for this provider',
    });
  }
});

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = checkedEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
