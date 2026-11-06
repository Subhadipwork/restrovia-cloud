/**
 * Creates the first super admin on a new server, where the seed script refuses to run. Refuses once
 * any admin exists; later admins are added from the admin panel. Reads ADMIN_NAME, ADMIN_EMAIL and
 * ADMIN_PASSWORD so the password never appears on a command line.
 */
import { pathToFileURL } from 'node:url';
import { count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { z } from 'zod';
import { writeAudit } from '../admin/audit.js';
import * as schema from './schema/index.js';

const input = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_NAME: z.string().trim().min(1).max(100).default('Super admin'),
  ADMIN_EMAIL: z.email().max(255),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters').max(200),
});

export async function createFirstAdmin(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const parsed = input.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const { DATABASE_URL, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = parsed.data;
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    return await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(schema.admins);
      if (n > 0) throw new Error('An admin already exists; add more admins from the admin panel');
      const [admin] = await tx
        .insert(schema.admins)
        .values({
          name: ADMIN_NAME,
          email: ADMIN_EMAIL,
          passwordHash: await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id }),
          role: 'super_admin',
        })
        .returning({ id: schema.admins.id });
      await writeAudit(tx, {
        adminId: admin.id,
        action: 'admin.bootstrap',
        targetType: 'admin',
        targetId: admin.id,
        details: { email: ADMIN_EMAIL },
      });
      return admin.id;
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  createFirstAdmin()
    .then(() => console.log('Super admin created. Sign in to the admin panel to set up 2FA.'))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
