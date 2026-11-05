'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api-client';

export function Pager({
  page,
  perPage,
  total,
  onPage
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm'>
      <span>
        {from}–{to} of {total}
      </span>
      <div className='flex gap-2'>
        <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** Loading and error states shared by every screen. */
export function QueryState({
  isPending,
  error,
  rows = 5
}: {
  isPending: boolean;
  error: unknown;
  rows?: number;
}) {
  if (error) {
    return (
      <div className='text-destructive rounded-lg border border-dashed p-6 text-sm' role='alert'>
        {errorMessage(error)}
      </div>
    );
  }
  if (isPending) {
    return (
      <div className='flex flex-col gap-2' role='status' aria-label='Loading'>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className='h-10 w-full' />
        ))}
      </div>
    );
  }
  return null;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className='text-muted-foreground p-6 text-center text-sm'>
        {children}
      </td>
    </tr>
  );
}

export function StatCard({
  label,
  value,
  hint
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className='bg-card rounded-xl border p-4'>
      <div className='text-muted-foreground text-sm'>{label}</div>
      <div className='mt-1 text-2xl font-semibold tabular-nums'>{value}</div>
      {hint && <div className='text-muted-foreground mt-1 text-xs'>{hint}</div>}
    </div>
  );
}
