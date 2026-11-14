const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Today's date in IST as YYYY-MM-DD, shifted by whole days. */
export function istDay(offsetDays = 0, now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export function istMonthStart(now = Date.now()): string {
  return `${istDay(0, now).slice(0, 8)}01`;
}

/** First and last day of the previous IST calendar month. */
export function istLastMonth(now = Date.now()): [string, string] {
  const firstThisMonth = istMonthStart(now);
  const lastPrev = new Date(Date.parse(`${firstThisMonth}T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
  return [`${lastPrev.slice(0, 8)}01`, lastPrev];
}

/** "16 Oct", for range labels and chart ticks. */
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`)
  );

export const DATE_PRESETS = [
  { label: 'Last 7 days', range: (): [string, string] => [istDay(-6), istDay()] },
  { label: 'Last 30 days', range: (): [string, string] => [istDay(-29), istDay()] },
  { label: 'This month', range: (): [string, string] => [istMonthStart(), istDay()] },
  { label: 'Last month', range: istLastMonth }
] as const;
