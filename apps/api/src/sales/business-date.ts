/**
 * The business date an instant belongs to, in the store's timezone. A store whose day starts at
 * 04:00 counts a 01:30 sale on the previous date, matching how late-night cafés close their day.
 */
export function businessDate(at: Date, timezone: string, dayStart = '00:00'): string {
  const [hours, minutes] = dayStart.split(':').map(Number);
  const shifted = new Date(at.getTime() - ((hours || 0) * 60 + (minutes || 0)) * 60_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}
