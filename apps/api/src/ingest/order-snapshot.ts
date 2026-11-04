/**
 * Maps an order snapshot from the POS (decorateOrders in the POS cloud-sync service: the orders row
 * plus items, table, bill and bills) to cloud rows. The POS already strips customer data; the same
 * keys are stripped again here so a POS bug can't store them.
 */
import { isRecord, money, posInt, posTime, qty, text } from '../common/pos-values.js';

const PII_ORDER_KEYS = [
  'customer',
  'customer_id',
  'delivery_address',
  'delivery_note',
  'special_instructions',
  'discount_reason',
  'cancellation_reason',
];
const PII_ITEM_KEYS = ['special_instructions'];
const PII_BILL_KEYS = ['payment_details', 'customer_id'];

const omit = (row: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

export type MappedItem = {
  posItemId: number | null;
  productName: string;
  productSku: string | null;
  variantId: number | null;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  status: string | null;
  voidedAt: Date | null;
};

export type MappedBill = {
  posBillId: number | null;
  billNumber: string | null;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  paidAmount: string;
  balance: string;
  paymentStatus: string | null;
  paidAt: Date | null;
  splitLabel: string | null;
};

export type MappedOrder = {
  posOrderId: number;
  orderNumber: string | null;
  type: string | null;
  onlinePlatform: string | null;
  externalOrderId: string | null;
  status: string | null;
  tableName: string | null;
  guestCount: number | null;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  packagingCharge: string;
  deliveryCharge: string;
  serviceCharge: string;
  roundOff: string;
  total: string;
  paidAmount: string;
  paymentStatus: string | null;
  posCreatedAt: Date;
  posUpdatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  snapshot: Record<string, unknown>;
  items: MappedItem[];
  bills: MappedBill[];
};

/** Returns null when the snapshot has no usable order id or creation time. */
export function mapOrderSnapshot(payload: unknown): MappedOrder | null {
  if (!isRecord(payload)) return null;
  const posOrderId = posInt(payload.id);
  const createdAt = posTime(payload.created_at);
  if (posOrderId === null || !createdAt) return null;

  const items = (Array.isArray(payload.items) ? payload.items : [])
    .filter(isRecord)
    .map((row) => omit(row, PII_ITEM_KEYS));
  const bills = (Array.isArray(payload.bills) ? payload.bills : [])
    .filter(isRecord)
    .map((row) => omit(row, PII_BILL_KEYS));
  const table = isRecord(payload.table) ? payload.table : null;
  const snapshot: Record<string, unknown> = {
    ...omit(payload, PII_ORDER_KEYS),
    items,
    bills,
    bill: isRecord(payload.bill) ? omit(payload.bill, PII_BILL_KEYS) : null,
  };

  const mappedBills: MappedBill[] = bills.map((b) => ({
    posBillId: posInt(b.id),
    billNumber: text(b.bill_number),
    subtotal: money(b.subtotal),
    taxAmount: money(b.tax_amount),
    discountAmount: money(b.discount_amount),
    total: money(b.total),
    paidAmount: money(b.paid_amount),
    balance: money(b.balance),
    paymentStatus: text(b.payment_status),
    paidAt: posTime(b.paid_at),
    splitLabel: text(b.split_label),
  }));
  const paidTotal = mappedBills.reduce((sum, b) => sum + Number(b.paidAmount), 0);
  const paymentStatus =
    mappedBills.length === 0
      ? null
      : mappedBills.every((b) => b.paymentStatus === 'paid')
        ? 'paid'
        : (mappedBills.find((b) => b.paymentStatus !== 'paid')?.paymentStatus ?? null);

  return {
    posOrderId,
    orderNumber: text(payload.order_number),
    type: text(payload.type),
    onlinePlatform: text(payload.online_platform),
    externalOrderId: text(payload.external_order_id),
    status: text(payload.status),
    tableName: table ? text(table.name ?? table.number) : null,
    guestCount: posInt(payload.guest_count),
    subtotal: money(payload.subtotal),
    taxAmount: money(payload.tax_amount),
    discountAmount: money(payload.discount_amount),
    packagingCharge: money(payload.packaging_charge),
    deliveryCharge: money(payload.delivery_charge),
    serviceCharge: money(payload.service_charge),
    roundOff: money(payload.round_off),
    total: money(payload.total),
    paidAmount: paidTotal.toFixed(2),
    paymentStatus,
    posCreatedAt: createdAt,
    posUpdatedAt: posTime(payload.updated_at) ?? createdAt,
    completedAt: posTime(payload.completed_at),
    cancelledAt: posTime(payload.cancelled_at),
    snapshot,
    items: items.map((i) => ({
      posItemId: posInt(i.id),
      productName: text(i.product_name) ?? '',
      productSku: text(i.product_sku),
      variantId: posInt(i.variant_id),
      quantity: qty(i.quantity),
      unitPrice: money(i.unit_price),
      subtotal: money(i.subtotal),
      taxAmount: money(i.tax_amount),
      discountAmount: money(i.discount_amount),
      total: money(i.total),
      status: text(i.status),
      voidedAt: posTime(i.voided_at),
    })),
    bills: mappedBills,
  };
}
