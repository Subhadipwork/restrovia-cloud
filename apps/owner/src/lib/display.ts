/** Dates and labels as café owners read them (Indian English). */

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
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
