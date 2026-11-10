/** Dates and labels as café owners read them (Indian English). */

/** With `timeZone`, in the store's time rather than the phone's. */
export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone }).format(new Date(value));
}

/** A business date (YYYY-MM-DD) as "Tue, 20 Oct". */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A business date as "20 Oct". */
export function formatShortDay(day: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${day}T00:00:00Z`));
}

/** The month a business date is in, as "Oct 2026". */
export function formatMonth(day: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A business date `n` days later (or earlier, when negative). */
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function formatMoney(value: string | number | null | undefined, currency = 'INR'): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

/** Percentage change from `before` to `now`, or null when there is nothing to compare with. */
export function change(now: string | number, before: string | number): number | null {
  const a = Number(now);
  const b = Number(before);
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
  online: 'Online',
  unknown: 'Other'
};
export const orderTypeLabel = (type: string | null, platform?: string | null) =>
  platform ? platform : (ORDER_TYPE_LABELS[type ?? 'unknown'] ?? type ?? 'Other');

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  completed: 'Completed',
  cancelled: 'Cancelled'
};
export const orderStatusLabel = (status: string | null) =>
  ORDER_STATUS_LABELS[status ?? ''] ?? status ?? '—';

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

/** "Chrome on Android" from a user agent; good enough to recognise your own devices. */
export function deviceName(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari/.test(ua)
            ? 'Safari'
            : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  'owner.created': 'Account created by Restrovia',
  'owner.account_setup': 'Password chosen from the invite',
  'owner.login': 'Signed in',
  'owner.login_failed': 'Wrong password or code',
  'owner.locked': 'Sign-in paused after too many wrong tries',
  'owner.logout': 'Signed out',
  'owner.email_changed': 'Email changed',
  'owner.password_changed': 'Password changed',
  'owner.password_reset': 'Password reset by email',
  'owner.password_set_by_support': 'Password set by Restrovia support',
  'owner.2fa_enabled': 'Two-factor authentication turned on',
  'owner.2fa_disabled': 'Two-factor authentication turned off',
  'owner.2fa_reset_by_support': 'Two-factor authentication reset by Restrovia support',
  'owner.recovery_code_used': 'Signed in with a recovery code',
  'owner.recovery_codes_regenerated': 'New recovery codes made'
};
