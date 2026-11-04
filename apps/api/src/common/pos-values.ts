/** Converting values from POS snapshots, which come from SQLite rows. */

/** POS timestamps are SQLite `YYYY-MM-DD HH:MM:SS` in UTC, or ISO strings. */
export function posTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) text += 'Z';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decimal(value: unknown, digits: number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : (0).toFixed(digits);
}

export const money = (value: unknown) => decimal(value, 2);
export const qty = (value: unknown) => decimal(value, 3);

export function posInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
}

export function text(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
