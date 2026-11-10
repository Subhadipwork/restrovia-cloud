import { storeCode } from '../owner-stores/owner-stores.service.js';
import type { StoreRow } from '../owner-stores/store-member.guard.js';
import type {
  HoursReport,
  ItemsReport,
  PaymentsReport,
  SalesReport,
} from './owner-reports.service.js';

type Cell = string | number;

const BOM = String.fromCharCode(0xfeff);

/** Quotes a cell where CSV needs it, and stops Excel running text that starts like a formula. */
function cell(value: Cell): string {
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The café, range and currency on top, then the table. The byte-order mark is for Excel. */
function csv(
  store: StoreRow,
  title: string,
  range: { from: string; to: string },
  rows: Cell[][],
): string {
  const lines: Cell[][] = [
    ['Café', store.name],
    ['Report', title],
    ['From', range.from],
    ['To', range.to],
    ['Currency', store.currency ?? 'INR'],
    [],
    ...rows,
  ];
  return `${BOM}${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`;
}

export const csvFileName = (store: StoreRow, report: string, range: { from: string; to: string }) =>
  `${storeCode(store.id)}-${report}-${range.from}-to-${range.to}.csv`;

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const trimQuantity = (quantity: string) => String(Number(quantity));

export function salesCsv(store: StoreRow, report: SalesReport): string {
  const totals = (t: SalesReport['totals']): Cell[] => [
    t.orders_count,
    t.cancelled_count,
    t.bills_count,
    t.gross_sales,
    t.net_sales,
    t.tax_total,
    t.discount_total,
    t.avg_bill,
  ];
  return csv(store, `Sales by ${report.group}`, report, [
    [
      'From',
      'To',
      'Orders',
      'Cancelled orders',
      'Paid bills',
      'Sales',
      'Net of tax',
      'Tax',
      'Discount',
      'Average bill',
    ],
    ...report.periods.map((p) => [p.start, p.end, ...totals(p)]),
    ['Total', '', ...totals(report.totals)],
  ]);
}

export function itemsCsv(store: StoreRow, report: ItemsReport): string {
  return csv(store, 'Items sold', report, [
    ['Item', 'Quantity', 'Sales', 'Share of sales %'],
    ...report.items.map((i) => [i.name, trimQuantity(i.quantity), i.revenue, i.share]),
    ['All items', trimQuantity(report.totals.quantity), report.totals.revenue, ''],
  ]);
}

export function hoursCsv(store: StoreRow, report: HoursReport): string {
  return csv(store, 'Sales by hour', report, [
    ['Hour', 'Sales', 'Average per day with sales'],
    ...report.hours.map((h) => [hourLabel(h.hour), h.sales, h.average]),
    ['Total', report.total_sales, ''],
  ]);
}

export function paymentsCsv(store: StoreRow, report: PaymentsReport): string {
  return csv(store, 'Payments', report, [
    ['Method', 'Payments', 'Amount', 'Share %'],
    ...report.methods.map((m) => [m.method, m.count, m.amount, m.percent]),
    ['Total', '', report.total, ''],
  ]);
}
