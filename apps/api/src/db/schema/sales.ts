/**
 * Order data synced from the POS. Values such as order type and status are stored as the POS sends
 * them; the POS is the authority for those, so they have no check constraints here.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, moneyZero, quantity, tstz, updatedAt } from './columns.js';
import { posDevices, stores } from './stores.js';

export const syncEvents = pgTable(
  'sync_events',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => posDevices.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload'),
    receivedAt: tstz('received_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.eventId] }),
    index('sync_events_store_received_idx').on(t.storeId, t.receivedAt),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => posDevices.id, { onDelete: 'set null' }),
    posOrderId: bigint('pos_order_id', { mode: 'number' }).notNull(),
    orderNumber: text('order_number'),
    type: text('type'),
    onlinePlatform: text('online_platform'),
    externalOrderId: text('external_order_id'),
    status: text('status'),
    tableName: text('table_name'),
    guestCount: integer('guest_count'),
    subtotal: moneyZero('subtotal'),
    taxAmount: moneyZero('tax_amount'),
    discountAmount: moneyZero('discount_amount'),
    packagingCharge: moneyZero('packaging_charge'),
    deliveryCharge: moneyZero('delivery_charge'),
    serviceCharge: moneyZero('service_charge'),
    roundOff: moneyZero('round_off'),
    total: moneyZero('total'),
    paidAmount: moneyZero('paid_amount'),
    paymentStatus: text('payment_status'),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    posCreatedAt: tstz('pos_created_at').notNull(),
    posUpdatedAt: tstz('pos_updated_at').notNull(),
    completedAt: tstz('completed_at'),
    cancelledAt: tstz('cancelled_at'),
    snapshot: jsonb('snapshot').notNull(),
    syncedAt: tstz('synced_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_store_pos_order_key').on(t.storeId, t.posOrderId),
    index('orders_store_business_date_idx').on(t.storeId, t.businessDate),
    index('orders_store_open_idx')
      .on(t.storeId, t.status)
      .where(sql`${t.status} not in ('completed', 'cancelled')`),
    index('orders_store_number_idx').on(t.storeId, t.orderNumber),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    posItemId: bigint('pos_item_id', { mode: 'number' }),
    productName: text('product_name').notNull(),
    productSku: text('product_sku'),
    variantId: bigint('variant_id', { mode: 'number' }),
    quantity: quantity('quantity').notNull().default('0'),
    unitPrice: moneyZero('unit_price'),
    subtotal: moneyZero('subtotal'),
    taxAmount: moneyZero('tax_amount'),
    discountAmount: moneyZero('discount_amount'),
    total: moneyZero('total'),
    status: text('status'),
    voidedAt: tstz('voided_at'),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_store_business_date_idx').on(t.storeId, t.businessDate),
  ],
);

export const orderBills = pgTable(
  'order_bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    posBillId: bigint('pos_bill_id', { mode: 'number' }),
    billNumber: text('bill_number'),
    subtotal: moneyZero('subtotal'),
    taxAmount: moneyZero('tax_amount'),
    discountAmount: moneyZero('discount_amount'),
    total: moneyZero('total'),
    paidAmount: moneyZero('paid_amount'),
    balance: moneyZero('balance'),
    paymentStatus: text('payment_status'),
    paidAt: tstz('paid_at'),
    splitLabel: text('split_label'),
  },
  (t) => [index('order_bills_order_idx').on(t.orderId)],
);

export const dailyStoreStats = pgTable(
  'daily_store_stats',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    billsCount: integer('bills_count').notNull().default(0),
    cancelledCount: integer('cancelled_count').notNull().default(0),
    grossSales: moneyZero('gross_sales'),
    netSales: moneyZero('net_sales'),
    taxTotal: moneyZero('tax_total'),
    discountTotal: moneyZero('discount_total'),
    avgBill: moneyZero('avg_bill'),
    byType: jsonb('by_type')
      .$type<Record<string, { sales: string; count: number }>>()
      .notNull()
      .default({}),
    byHour: jsonb('by_hour').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.businessDate] })],
);
