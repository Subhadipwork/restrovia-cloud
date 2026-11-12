/** Dates, money and labels as Restrovia admins read them (Indian English, IST by default). */

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

export function formatMoney(value: string | number | null | undefined, currency = 'INR'): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function timeAgo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'never';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const LICENCE_LABELS: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Payment due',
  expired: 'Expired',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  none: 'No licence'
};

export const TICKET_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting on customer',
  resolved: 'Resolved'
};

export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline';

export function licenceTone(status: string | null | undefined): BadgeTone {
  if (status === 'active') return 'default';
  if (status === 'trial') return 'secondary';
  if (status === 'suspended' || status === 'expired' || status === 'past_due') return 'destructive';
  return 'outline';
}

/** The store code Restrovia POS shows in Settings → About: first 8 characters of the id, upper case. */
export function storeCode(storeId: string): string {
  return storeId.replace(/-/g, '').slice(0, 8).toUpperCase();
}
