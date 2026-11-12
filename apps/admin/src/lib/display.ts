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

/** "45 min", "3 h 20 min", "2 d 4 h". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Admin actions on a store, as the store page's activity list names them. */
export const ACTIVITY_LABELS: Record<string, string> = {
  'store.block': 'Blocked cloud access',
  'store.unblock': 'Lifted the block',
  'licence.extend_trial': 'Extended the trial',
  'licence.activate': 'Activated a plan',
  'licence.suspend': 'Suspended the licence',
  'device.reset_binding': 'Reset a POS computer binding',
  'owner.create': 'Added an owner',
  'owner.link_store': 'Linked an owner',
  'owner.unlink_store': 'Removed an owner',
  'owner.resend_invite': 'Resent an owner invite',
  'owner.set_password': 'Set an owner password'
};

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
