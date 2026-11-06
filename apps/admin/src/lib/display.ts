/** Dates, money and labels as Restrovia admins read them (Indian English, IST by default). */

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value));
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
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
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
