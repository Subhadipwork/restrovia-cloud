import type { EmailMessage } from '../email/email.service.js';
import { message } from '../owner/owner-emails.js';
import type { ReportTotals } from '../owner-reports/owner-reports.service.js';

export type DailySummary = {
  storeName: string;
  currency: string;
  /** Business date, YYYY-MM-DD. */
  day: string;
  totals: ReportTotals;
  /** The same weekday a week earlier. */
  lastWeek: ReportTotals;
  byType: Record<string, { sales: string; count: number }>;
  topItems: { name: string; quantity: string; revenue: string }[];
  cancelled: { count: number; value: string };
  discounts: { count: number; total: string };
};

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
  online: 'Online',
  unknown: 'Other',
};

function money(value: string | number, currency: string): string {
  const n = Number(value);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

const dayParts = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...options }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** " (▲ 12% vs last Tuesday)", or nothing when last week had none to compare with. */
function change(now: string | number, before: string | number, weekday: string): string {
  const b = Number(before);
  if (!b) return '';
  const pct = Math.round(((Number(now) - b) / b) * 100);
  const arrow = pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '';
  return ` (${arrow}${Math.abs(pct)}% vs last ${weekday})`;
}

export const alertEmails = {
  dailySummary(
    to: string,
    s: DailySummary,
    links: { day: string; turnOff: string },
    sample = false,
  ): EmailMessage {
    const weekday = dayParts(s.day, { weekday: 'long' });
    const date = dayParts(s.day, { weekday: 'short', day: 'numeric', month: 'short' });
    const types = Object.entries(s.byType)
      .sort((a, b) => Number(b[1].sales) - Number(a[1].sales))
      .map(([type, t]) => `${TYPE_LABELS[type] ?? type} ${money(t.sales, s.currency)}`);
    const checks = [
      s.cancelled.count > 0 &&
        `Cancelled orders: ${s.cancelled.count} (${money(s.cancelled.value, s.currency)})`,
      s.discounts.count > 0 &&
        `Discounts: ${money(s.discounts.total, s.currency)} on ${s.discounts.count} ${s.discounts.count === 1 ? 'order' : 'orders'}`,
    ].filter((line): line is string => !!line);

    return message(
      to,
      `${sample ? 'Sample: ' : ''}${s.storeName}: ${money(s.totals.gross_sales, s.currency)} on ${date}`,
      [
        [
          `Sales: ${money(s.totals.gross_sales, s.currency)}${change(s.totals.gross_sales, s.lastWeek.gross_sales, weekday)}`,
          `Paid bills: ${s.totals.bills_count}${change(s.totals.bills_count, s.lastWeek.bills_count, weekday)}`,
          `Average bill: ${money(s.totals.avg_bill, s.currency)}${change(s.totals.avg_bill, s.lastWeek.avg_bill, weekday)}`,
        ].join('\n'),
        ...(types.length > 0 ? [`By order type: ${types.join(', ')}`] : []),
        ...(s.topItems.length > 0
          ? [
              [
                'Top items:',
                ...s.topItems.map(
                  (i) => `${Number(i.quantity)} × ${i.name}: ${money(i.revenue, s.currency)}`,
                ),
              ].join('\n'),
            ]
          : []),
        ...(checks.length > 0 ? [checks.join('\n')] : []),
        'Sales count bills on the day they were paid, before refunds.',
      ],
      { url: links.day, label: 'Open this day' },
      { url: links.turnOff, label: 'Turn off daily summaries' },
    );
  },

  storeOffline(
    to: string,
    storeName: string,
    lastSeen: string,
    links: { status: string; turnOff: string },
  ): EmailMessage {
    return message(
      to,
      `${storeName}: the POS is offline`,
      [
        `Restrovia Cloud has not heard from the POS at ${storeName} since ${lastSeen}, at a time the café is usually selling.`,
        'The POS keeps billing without internet and sends its orders when it reconnects. If the café is closed today, you can ignore this email.',
      ],
      { url: links.status, label: 'See POS status' },
      { url: links.turnOff, label: 'Turn off offline alerts' },
    );
  },
};
