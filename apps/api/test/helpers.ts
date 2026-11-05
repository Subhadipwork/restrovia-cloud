import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema/index.js';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error('TEST_DATABASE_URL is not set; database tests must run, not be skipped');
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must name a database ending in "_test" (it is wiped)');
  }
  return url;
}

/** Drops everything and rebuilds the schema from the migrations. */
export async function resetDatabase(
  url: string,
): Promise<{ pool: Pool; db: NodePgDatabase<typeof schema> }> {
  const pool = new Pool({ connectionString: url, max: 2 });
  await pool.query(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  await runMigrations(url);
  return { pool, db: drizzle(pool, { schema }) };
}

export const testMasterKey = randomBytes(32).toString('base64');

/** Throwaway licence signing key pair; tests verify tokens with the public half. */
const licenceKeys = generateKeyPairSync('ed25519');
export const testLicencePublicKey = licenceKeys.publicKey;
export const testLicenceSigningKey = licenceKeys.privateKey
  .export({ format: 'der', type: 'pkcs8' })
  .toString('base64');

/** The API exactly as main.ts builds it. */
export async function createTestApp(url: string): Promise<NestExpressApplication> {
  process.env.DATABASE_URL = url;
  process.env.MASTER_KEY = testMasterKey;
  process.env.LICENCE_SIGNING_KEY ??= testLicenceSigningKey;
  process.env.REGISTER_LIMIT_PER_HOUR ??= '1000';
  // Imported late because ConfigModule validates the environment when the module loads.
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }),
  );
  await app.init();
  return app;
}

export type PosIdentity = { posHash: string; deviceSecret: string; apiKey: string };

/** Mirrors buildSignedHeaders in the POS cloud-sync service. */
export function signedHeaders(
  id: Pick<PosIdentity, 'apiKey' | 'posHash'>,
  method: string,
  path: string,
  body: string,
  overrides: { timestamp?: string; nonce?: string } = {},
): Record<string, string> {
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const nonce = overrides.nonce ?? randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const base = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
  const signature = createHmac('sha256', id.apiKey).update(base).digest('hex');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${id.apiKey}`,
    'X-Flo-POS-Hash': id.posHash,
    'X-Flo-Timestamp': timestamp,
    'X-Flo-Nonce': nonce,
    'X-Flo-Body-SHA256': bodyHash,
    'X-Flo-Signature': `sha256=${signature}`,
  };
}

/** A signed request the way the POS sends it (raw JSON string body). */
export function posCall(
  app: NestExpressApplication,
  id: Pick<PosIdentity, 'apiKey' | 'posHash'>,
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown,
  headerOverrides: Record<string, string> = {},
) {
  const body = method === 'GET' ? '' : JSON.stringify(payload ?? {});
  const headers = { ...signedHeaders(id, method, path, body), ...headerOverrides };
  const req =
    method === 'GET'
      ? request(app.getHttpServer()).get(path)
      : request(app.getHttpServer()).post(path);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return method === 'GET' ? req : req.send(body);
}

export function registerBody(posHash = `pos-${randomUUID()}`, deviceSecret = randomUUID()) {
  return {
    pos_hash: posHash,
    device_secret_hash: createHash('sha256').update(deviceSecret).digest('hex'),
    device_name: 'CAFE-PC',
    platform: 'win32',
    arch: 'x64',
    app_version: '3.13.14',
    run_mode: 'desktop',
    install_source: 'installer',
    store_type: 'cafe',
    business: {
      name: 'Blue Door Café',
      contact_name: 'Asha',
      email: 'owner@bluedoor.example',
      phone: '+919800000000',
      instagram_handle: '',
      country: 'IN',
      currency: 'INR',
      country_source: 'explicit',
      timezone: 'Asia/Kolkata',
      address: 'MG Road',
    },
    requested_at: new Date().toISOString(),
  };
}

export async function registerPos(
  app: NestExpressApplication,
): Promise<PosIdentity & { posId: string; storeId: string }> {
  const body = registerBody();
  const res = await request(app.getHttpServer()).post('/api/pos/register').send(body).expect(200);
  return {
    posHash: body.pos_hash,
    deviceSecret: body.device_secret_hash,
    apiKey: res.body.api_key,
    posId: res.body.pos_id,
    storeId: res.body.store_id,
  };
}

/** SQLite CURRENT_TIMESTAMP format, as the POS stores times. */
export const sqliteTime = (d: Date) => d.toISOString().replace('T', ' ').replace(/\..*$/, '');
