/**
 * Development seed: two plans, one super admin, and a sample store with orders.
 * Refuses to run in production. Safe to run more than once.
 */
import { pathToFileURL } from 'node:url';
import type { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DEFAULT_STORE_TIMEZONE, TRIAL_DAYS } from '@restrovia/shared';
import { CryptoService } from '../crypto/crypto.service.js';
import { businessDate } from '../sales/business-date.js';
import * as schema from './schema/index.js';

const SAMPLE_POS_HASH = 'seed-sample-pos';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function seed(connectionString: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production') throw new Error('The seed script never runs in production');
  const masterKey = env.MASTER_KEY ?? requireEnv('MASTER_KEY');
  const crypto = new CryptoService({ get: () => masterKey } as unknown as ConfigService<
    never,
    true
  >);
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.plans)
        .values([
          {
            code: 'outlet_monthly',
            name: 'Outlet monthly (sample price)',
            price: '999.00',
            interval: 'month',
          },
          {
            code: 'outlet_yearly',
            name: 'Outlet yearly (sample price)',
            price: '9999.00',
            interval: 'year',
          },
        ])
        .onConflictDoNothing();

      const adminEmail = env.SEED_ADMIN_EMAIL ?? requireEnv('SEED_ADMIN_EMAIL');
      const adminPassword = env.SEED_ADMIN_PASSWORD ?? requireEnv('SEED_ADMIN_PASSWORD');
      await tx
        .insert(schema.admins)
        .values({
          name: 'Super admin',
          email: adminEmail,
          passwordHash: await crypto.hashPassword(adminPassword),
          role: 'super_admin',
        })
        .onConflictDoNothing();

      const existing = await tx.query.posDevices.findFirst({
        where: eq(schema.posDevices.posHash, SAMPLE_POS_HASH),
      });
      if (existing) return;

      const [store] = await tx
        .insert(schema.stores)
        .values({
          name: 'Sample Café',
          contactName: 'Sample Owner',
          country: 'IN',
          currency: 'INR',
          timezone: DEFAULT_STORE_TIMEZONE,
          address: 'Sample address (seed data)',
        })
        .returning();

      const apiKey = crypto.randomToken();
      const [device] = await tx
        .insert(schema.posDevices)
        .values({
          storeId: store.id,
          posHash: SAMPLE_POS_HASH,
          apiKeyLookup: crypto.sha256(apiKey),
          apiKeyEnc: crypto.encrypt(apiKey),
          deviceSecretHash: crypto.sha256(crypto.randomToken()).toString('hex'),
          deviceName: 'SAMPLE-PC',
          platform: 'win32',
          appVersion: '3.13.14',
          lastHeartbeatAt: new Date(),
        })
        .returning();

      const now = new Date();
      // Names only the columns it fills, so the seed also runs on a database from before later
      // subscription columns existed (the upgrade test seeds one).
      await tx.execute(sql`
        insert into subscriptions (store_id, status, trial_ends_at, notes)
        values (${store.id}, 'trial',
          ${new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString()}::timestamptz,
          'Seed data')`);

      const sampleOrders = [
        {
          posId: 1,
          number: 'A-001',
          type: 'dine_in',
          table: 'T1',
          item: 'Cappuccino',
          qty: '2',
          price: '150.00',
        },
        {
          posId: 2,
          number: 'A-002',
          type: 'takeaway',
          table: null,
          item: 'Veg Sandwich',
          qty: '1',
          price: '180.00',
        },
        {
          posId: 3,
          number: 'A-003',
          type: 'delivery',
          table: null,
          item: 'Cold Coffee',
          qty: '3',
          price: '160.00',
        },
      ];
      const day = businessDate(now, store.timezone, store.businessDayStart);
      let gross = 0;
      const byType: Record<string, { sales: string; count: number }> = {};

      for (const o of sampleOrders) {
        const subtotal = Number(o.qty) * Number(o.price);
        const tax = Math.round(subtotal * 0.05 * 100) / 100;
        const total = (subtotal + tax).toFixed(2);
        gross += Number(total);
        byType[o.type] = { sales: total, count: 1 };

        const [order] = await tx
          .insert(schema.orders)
          .values({
            storeId: store.id,
            deviceId: device.id,
            posOrderId: o.posId,
            orderNumber: o.number,
            type: o.type,
            status: 'completed',
            tableName: o.table,
            subtotal: subtotal.toFixed(2),
            taxAmount: tax.toFixed(2),
            total,
            paidAmount: total,
            paymentStatus: 'paid',
            businessDate: day,
            posCreatedAt: now,
            posUpdatedAt: now,
            completedAt: now,
            snapshot: { seed: true, order_number: o.number },
          })
          .returning();
        await tx.insert(schema.orderItems).values({
          orderId: order.id,
          storeId: store.id,
          posItemId: o.posId,
          productName: o.item,
          quantity: o.qty,
          unitPrice: o.price,
          subtotal: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          total,
          status: 'served',
          businessDate: day,
        });
        await tx.insert(schema.orderBills).values({
          orderId: order.id,
          storeId: store.id,
          posBillId: o.posId,
          billNumber: `B-${o.posId}`,
          subtotal: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          total,
          paidAmount: total,
          paymentStatus: 'paid',
          paidAt: now,
        });
      }

      await tx.insert(schema.dailyStoreStats).values({
        storeId: store.id,
        businessDate: day,
        ordersCount: sampleOrders.length,
        billsCount: sampleOrders.length,
        grossSales: gross.toFixed(2),
        netSales: gross.toFixed(2),
        avgBill: (gross / sampleOrders.length).toFixed(2),
        byType,
      });
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  seed(requireEnv('DATABASE_URL'))
    .then(() => console.log('Seed data inserted'))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
