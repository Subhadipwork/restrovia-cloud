/**
 * Builds a fresh database from the migrations and checks the rules the schema must enforce.
 * Needs TEST_DATABASE_URL pointing at a database whose name ends in "_test"; it is wiped first.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import { createFirstAdmin } from '../src/db/create-admin.js';
import { runMigrations } from '../src/db/migrate.js';
import { SYSTEM_ROLE_IDS } from '@restrovia/shared';
import * as schema from '../src/db/schema/index.js';
import { seed } from '../src/db/seed.js';
import { CleanupService } from '../src/jobs/cleanup.service.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is not set; database tests must run, not be skipped');
}
if (!new URL(url).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must name a database ending in "_test" (it is wiped)');
}

const masterKey = randomBytes(32).toString('base64');
const seedEnv = {
  NODE_ENV: 'test',
  MASTER_KEY: masterKey,
  SEED_ADMIN_EMAIL: 'admin@example.test',
  SEED_ADMIN_PASSWORD: randomBytes(12).toString('base64url'),
} as NodeJS.ProcessEnv;

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? 'unknown';
  }
  throw new Error('Expected the database to reject this statement');
}

beforeAll(async () => {
  pool = new Pool({ connectionString: url, max: 2 });
  await pool.query(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  await runMigrations(url);
  db = drizzle(pool, { schema });
});

afterAll(async () => {
  await pool?.end();
});

describe('migrations', () => {
  it('create all 38 tables', async () => {
    const { rows } = await pool.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    expect(rows[0].n).toBe(38);
  });

  it('are safe to run again', async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });
});

describe('first admin on a new server', () => {
  const adminEnv = {
    DATABASE_URL: url,
    ADMIN_EMAIL: 'owner@example.test',
    ADMIN_PASSWORD: randomBytes(12).toString('base64url'),
  } as NodeJS.ProcessEnv;

  it('refuses a short password', async () => {
    await expect(createFirstAdmin({ ...adminEnv, ADMIN_PASSWORD: 'short' })).rejects.toThrow(
      /at least 12/,
    );
  });

  it('creates one super admin with a hashed password and an audit record', async () => {
    const id = await createFirstAdmin(adminEnv);
    const admin = await db.query.admins.findFirst({ where: eq(schema.admins.id, id) });
    expect(admin?.roleId).toBe(SYSTEM_ROLE_IDS.super_admin);
    expect(admin?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin?.totpSecretEnc).toBeNull();
    const audit = await db.query.adminAuditLog.findFirst({
      where: eq(schema.adminAuditLog.targetId, id),
    });
    expect(audit?.action).toBe('admin.bootstrap');
  });

  it('refuses once any admin exists', async () => {
    await expect(
      createFirstAdmin({ ...adminEnv, ADMIN_EMAIL: 'second@example.test' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('seed', () => {
  it('inserts plans, a super admin and a sample store, and can run twice', async () => {
    await seed(url, seedEnv);
    await seed(url, seedEnv);
    const counts = await pool.query(`select
      (select count(*)::int from plans) as plans,
      (select count(*)::int from admins where email = 'admin@example.test') as admins,
      (select count(*)::int from stores) as stores,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from daily_store_stats) as stats`);
    expect(counts.rows[0]).toEqual({ plans: 2, admins: 1, stores: 1, orders: 3, stats: 1 });
  });

  it('refuses to run in production', async () => {
    await expect(seed(url, { ...seedEnv, NODE_ENV: 'production' })).rejects.toThrow(/production/);
  });

  it('stores the API key encrypted, never in plain text', async () => {
    const device = await db.query.posDevices.findFirst();
    expect(device?.apiKeyEnc.length).toBeGreaterThan(28);
    expect(device?.apiKeyLookup.length).toBe(32);
  });
});

describe('schema rules', () => {
  const sampleStore = () => db.query.stores.findFirst().then((s) => s!);

  it('emails are case-insensitive and unique', async () => {
    const code = await pgError(
      db.insert(schema.admins).values({
        name: 'Copy',
        email: 'ADMIN@EXAMPLE.TEST',
        passwordHash: 'x',
        roleId: SYSTEM_ROLE_IDS.support,
      }),
    );
    expect(code).toBe('23505');
  });

  it('one POS order id is stored once per store', async () => {
    const store = await sampleStore();
    const code = await pgError(
      db.insert(schema.orders).values({
        storeId: store.id,
        posOrderId: 1,
        businessDate: '2026-11-04',
        posCreatedAt: new Date(),
        posUpdatedAt: new Date(),
        snapshot: {},
      }),
    );
    expect(code).toBe('23505');
  });

  it('the same POS order id is allowed in another store', async () => {
    const [other] = await db.insert(schema.stores).values({ name: 'Other café' }).returning();
    await expect(
      db.insert(schema.orders).values({
        storeId: other.id,
        posOrderId: 1,
        businessDate: '2026-11-04',
        posCreatedAt: new Date(),
        posUpdatedAt: new Date(),
        snapshot: {},
      }),
    ).resolves.toBeDefined();
  });

  it('a store has at most one current subscription', async () => {
    const store = await sampleStore();
    const code = await pgError(
      db.insert(schema.subscriptions).values({ storeId: store.id, status: 'active' }),
    );
    expect(code).toBe('23505');
    await expect(
      db.insert(schema.subscriptions).values({ storeId: store.id, status: 'expired' }),
    ).resolves.toBeDefined();
  });

  it('rejects unknown status values', async () => {
    const store = await sampleStore();
    expect(
      await pgError(
        db.update(schema.stores).set({ status: 'closed' }).where(eq(schema.stores.id, store.id)),
      ),
    ).toBe('23514');
    expect(
      await pgError(
        db.insert(schema.admins).values({
          name: 'x',
          email: 'x@example.test',
          passwordHash: 'x',
          roleId: '00000000-0000-4000-8000-0000000000ff',
        }),
      ),
    ).toBe('23503');
  });

  it('a replayed nonce is rejected', async () => {
    const device = (await db.query.posDevices.findFirst())!;
    const nonce = randomUUID();
    await db.insert(schema.requestNonces).values({ deviceId: device.id, nonce });
    expect(
      await pgError(db.insert(schema.requestNonces).values({ deviceId: device.id, nonce })),
    ).toBe('23505');
  });

  it('a resent sync event is rejected', async () => {
    const device = (await db.query.posDevices.findFirst())!;
    const event = {
      deviceId: device.id,
      eventId: 'evt-1',
      storeId: device.storeId,
      type: 'order.created',
      entityType: 'order',
      entityId: '1',
    };
    await db.insert(schema.syncEvents).values(event);
    expect(await pgError(db.insert(schema.syncEvents).values(event))).toBe('23505');
  });

  it('the admin audit log is append-only', async () => {
    const admin = (await db.query.admins.findFirst())!;
    await db.insert(schema.adminAuditLog).values({ adminId: admin.id, action: 'test.write' });
    expect(await pgError(db.update(schema.adminAuditLog).set({ action: 'changed' }))).toBe('P0001');
    expect(await pgError(db.delete(schema.adminAuditLog))).toBe('P0001');
    expect(await pgError(db.execute(sql`truncate admin_audit_log`))).toBe('P0001');
  });

  it('deleting a store removes its synced data', async () => {
    const [store] = await db.insert(schema.stores).values({ name: 'To delete' }).returning();
    await db.insert(schema.orders).values({
      storeId: store.id,
      posOrderId: 9,
      businessDate: '2026-11-04',
      posCreatedAt: new Date(),
      posUpdatedAt: new Date(),
      snapshot: {},
    });
    await db.delete(schema.stores).where(eq(schema.stores.id, store.id));
    const left = await db.select().from(schema.orders).where(eq(schema.orders.storeId, store.id));
    expect(left).toHaveLength(0);
  });
});

describe('API app', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.MASTER_KEY = masterKey;
    // Imported here because ConfigModule validates the environment when the module loads.
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /healthz reports the database is up', async () => {
    await request(app.getHttpServer())
      .get('/healthz')
      .expect(200, { status: 'ok', database: 'up' });
  });

  it('cleanup jobs remove old nonces and expire stale commands', async () => {
    const device = (await db.query.posDevices.findFirst())!;
    const old = new Date(Date.now() - 60 * 60_000);
    await db
      .insert(schema.requestNonces)
      .values({ deviceId: device.id, nonce: randomUUID(), seenAt: old });
    const [command] = await db
      .insert(schema.commands)
      .values({ storeId: device.storeId, deviceId: device.id, type: 'health.get', expiresAt: old })
      .returning();

    const cleanup = app.get(CleanupService);
    await cleanup.purgeNonces();
    await cleanup.expireCommands();
    await cleanup.nightly();

    const { rows } = await pool.query(
      'select count(*)::int as n from request_nonces where seen_at < $1',
      [new Date(Date.now() - 30 * 60_000)],
    );
    expect(rows[0].n).toBe(0);
    const after = await db.query.commands.findFirst({ where: eq(schema.commands.id, command.id) });
    expect(after?.status).toBe('expired');
  });
});

describe('upgrade', () => {
  it('keeps existing stores and admins through every later migration, admins keeping their access', async () => {
    await pool.query(
      'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
    );
    // The migrations as they stood before owner sign-in (up to 0006).
    const source = path.resolve(import.meta.dirname, '../drizzle');
    const before = mkdtempSync(path.join(tmpdir(), 'restrovia-migrations-'));
    try {
      cpSync(source, before, { recursive: true });
      const journalPath = path.join(before, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 6);
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrate(drizzle(pool), { migrationsFolder: before });
    } finally {
      rmSync(before, { recursive: true, force: true });
    }
    await seed(url, seedEnv, { withAdmin: false });
    // Admins as they were stored before roles became a table: a text role per admin.
    await pool.query(`insert into admins (name, email, password_hash, role) values
      ('Old super', 'super@example.test', 'x', 'super_admin'),
      ('Old support', 'support@example.test', 'x', 'support'),
      ('Old sales', 'sales@example.test', 'x', 'sales')`);

    await runMigrations(url);

    const roles = await pool.query(
      `select a.email, r.key from admins a join admin_roles r on r.id = a.role_id order by a.email`,
    );
    expect(roles.rows).toEqual([
      { email: 'sales@example.test', key: 'sales' },
      { email: 'super@example.test', key: 'super_admin' },
      { email: 'support@example.test', key: 'support' },
    ]);

    const counts = await pool.query(`select
      (select count(*)::int from stores) as stores,
      (select count(*)::int from admins) as admins,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_name in
          ('owner_recovery_codes', 'owner_email_tokens', 'owner_security_events')) as new_tables,
      (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_name = 'otp_codes') as otp_codes`);
    expect(counts.rows[0]).toEqual({
      stores: 1,
      admins: 3,
      orders: 3,
      new_tables: 3,
      otp_codes: 0,
    });
  });
});
