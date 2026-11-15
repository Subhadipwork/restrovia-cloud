'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ScheduleWindow = { days: number[]; start: string; end: string };

/** Monday first, as café owners read a week. */
const DAYS: { day: number; short: string; long: string }[] = [
  { day: 1, short: 'Mon', long: 'Monday' },
  { day: 2, short: 'Tue', long: 'Tuesday' },
  { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' },
  { day: 5, short: 'Fri', long: 'Friday' },
  { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 0, short: 'Sun', long: 'Sunday' }
];

/** "24:00" is how the POS says "until the end of the day"; a time box shows it as 00:00. */
const toBox = (time: string) => (time === '24:00' ? '00:00' : time);
const fromBox = (start: string, end: string) =>
  end === '00:00' && start !== '00:00' ? '24:00' : end;

export const sameSchedule = (a: ScheduleWindow[], b: ScheduleWindow[]) => {
  const key = (w: ScheduleWindow) => JSON.stringify([[...w.days].sort(), w.start, w.end]);
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
};

function dayText(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  const order = DAYS.filter((d) => set.has(d.day));
  const runs: string[] = [];
  for (let i = 0; i < order.length;) {
    let j = i;
    while (
      j + 1 < order.length &&
      DAYS.findIndex((d) => d.day === order[j + 1].day) ===
        DAYS.findIndex((d) => d.day === order[j].day) + 1
    )
      j++;
    runs.push(
      j - i >= 2
        ? `${order[i].short}–${order[j].short}`
        : order
            .slice(i, j + 1)
            .map((d) => d.short)
            .join(', ')
    );
    i = j + 1;
  }
  return runs.join(', ');
}

/** "Mon–Fri 07:00–11:00" for one or more windows. */
export function scheduleSummary(windows: ScheduleWindow[]): string {
  if (windows.length === 0) return 'All day';
  return windows.map((w) => `${dayText(w.days)} ${w.start}–${toBox(w.end)}`).join(' · ');
}

/** The first thing wrong with the hours, or null. */
export function scheduleProblem(windows: ScheduleWindow[]): string | null {
  for (const [i, w] of windows.entries()) {
    if (w.days.length === 0) return `Hours ${i + 1}: choose at least one day.`;
    if (!w.start || !w.end) return `Hours ${i + 1}: set a start and an end time.`;
    if (w.start === w.end) return `Hours ${i + 1}: the start and end can’t be the same.`;
  }
  return null;
}

export function ScheduleEditor({
  value,
  onChange
}: {
  value: ScheduleWindow[];
  onChange: (windows: ScheduleWindow[]) => void;
}) {
  const set = (i: number, patch: Partial<ScheduleWindow>) =>
    onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className='flex flex-col gap-2 sm:col-span-2'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>Hours offered</span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            onChange([...value, { days: [1, 2, 3, 4, 5, 6, 0], start: '07:00', end: '11:00' }])
          }
        >
          Add hours
        </Button>
      </div>
      {value.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Offered all day, every day. Add hours to offer it only at certain times, such as a
          breakfast menu.
        </p>
      ) : (
        <ul className='flex flex-col gap-3'>
          {value.map((w, i) => (
            <li key={i} className='flex flex-col gap-2 rounded-lg border p-3'>
              <div
                className='flex flex-wrap gap-1'
                role='group'
                aria-label={`Days for hours ${i + 1}`}
              >
                {DAYS.map((d) => {
                  const on = w.days.includes(d.day);
                  return (
                    <button
                      key={d.day}
                      type='button'
                      aria-pressed={on}
                      aria-label={d.long}
                      onClick={() =>
                        set(i, {
                          days: on ? w.days.filter((x) => x !== d.day) : [...w.days, d.day]
                        })
                      }
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs',
                        on
                          ? 'bg-primary text-primary-foreground border-transparent'
                          : 'text-muted-foreground'
                      )}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <Input
                  type='time'
                  aria-label={`Hours ${i + 1} start`}
                  className='w-32'
                  value={w.start}
                  onChange={(e) => set(i, { start: e.target.value })}
                />
                <span className='text-muted-foreground text-sm'>to</span>
                <Input
                  type='time'
                  aria-label={`Hours ${i + 1} end`}
                  className='w-32'
                  value={toBox(w.end)}
                  onChange={(e) => set(i, { end: fromBox(w.start, e.target.value) })}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
              {w.start && w.end && w.start > toBox(w.end) && toBox(w.end) !== '00:00' && (
                <p className='text-muted-foreground text-xs'>
                  Ends after midnight, the next morning.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
