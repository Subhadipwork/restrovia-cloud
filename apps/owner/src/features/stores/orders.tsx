'use client';

import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { errorMessage } from '@/lib/api-client';
import {
  formatDay,
  formatMoney,
  formatTime,
  orderStatusLabel,
  orderTypeLabel
} from '@/lib/display';
import { cn } from '@/lib/utils';
import { useOrders, useStores, type OrderRow } from './api';

function statusTone(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'cancelled') return 'destructive';
  if (status === 'completed') return 'outline';
  return 'secondary';
}

function Row({
  order,
  storeId,
  currency,
  timeZone,
  showDay
}: {
  order: OrderRow;
  storeId: string;
  currency: string;
  timeZone: string;
  showDay: boolean;
}) {
  return (
    <li>
      <Link
        href={`/dashboard/${storeId}/orders/${order.id}`}
        aria-label={`Order ${order.order_number ?? order.pos_order_id}`}
        className='hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3'
      >
        <div className='min-w-0'>
          <div className='flex items-center gap-2 font-medium'>
            #{order.order_number ?? order.pos_order_id}
            {order.status !== 'completed' && (
              <Badge variant={statusTone(order.status)}>{orderStatusLabel(order.status)}</Badge>
            )}
          </div>
          <div className='text-muted-foreground truncate text-xs'>
            {showDay && `${formatDay(order.business_date)} · `}
            {formatTime(order.created_at, timeZone)} ·{' '}
            {orderTypeLabel(order.type, order.online_platform)}
            {order.table && ` · Table ${order.table}`} · {order.items_count}{' '}
            {order.items_count === 1 ? 'item' : 'items'}
          </div>
        </div>
        <div className='text-right'>
          <div
            className={cn(
              'font-semibold tabular-nums',
              order.status === 'cancelled' && 'line-through opacity-60'
            )}
          >
            {formatMoney(order.total, currency)}
          </div>
          {order.status !== 'cancelled' && order.payment_status !== 'paid' && (
            <div className='text-xs text-amber-600 dark:text-amber-400'>Not paid</div>
          )}
        </div>
      </Link>
    </li>
  );
}

export function OrdersScreen({ storeId }: { storeId: string }) {
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const today = store?.today.business_date;
  const [params, setParams] = useQueryStates({
    from: parseAsString,
    to: parseAsString,
    type: parseAsString,
    status: parseAsString,
    q: parseAsString
  });
  const [search, setSearch] = useState(params.q ?? '');
  const debounced = useDebounce(search, 400);
  useEffect(() => {
    if (debounced !== (params.q ?? '')) void setParams({ q: debounced || null });
  }, [debounced, params.q, setParams]);

  const from = params.from ?? today;
  const to = params.to ?? from;
  const filters = {
    from,
    to,
    type: params.type ?? undefined,
    status: params.status ?? undefined,
    q: params.q ?? undefined
  };
  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useOrders(
    storeId,
    filters
  );
  const first = data?.pages[0];
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-2 sm:flex sm:flex-wrap'>
        <Input
          type='date'
          aria-label='From'
          className='sm:w-auto'
          value={from ?? ''}
          max={today}
          onChange={(e) =>
            void setParams({
              from: e.target.value || null,
              to: params.to && e.target.value > params.to ? e.target.value : params.to
            })
          }
        />
        <Input
          type='date'
          aria-label='To'
          className='sm:w-auto'
          value={to ?? ''}
          min={from}
          max={today}
          onChange={(e) => void setParams({ to: e.target.value || null })}
        />
        <NativeSelect
          aria-label='Order type'
          value={params.type ?? ''}
          onChange={(e) => void setParams({ type: e.target.value || null })}
        >
          <NativeSelectOption value=''>All types</NativeSelectOption>
          {(first?.types ?? []).map((t) => (
            <NativeSelectOption key={t} value={t}>
              {orderTypeLabel(t)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label='Status'
          value={params.status ?? ''}
          onChange={(e) => void setParams({ status: e.target.value || null })}
        >
          <NativeSelectOption value=''>All orders</NativeSelectOption>
          <NativeSelectOption value='open'>Open</NativeSelectOption>
          <NativeSelectOption value='completed'>Completed</NativeSelectOption>
          <NativeSelectOption value='cancelled'>Cancelled</NativeSelectOption>
        </NativeSelect>
        <Input
          type='search'
          aria-label='Search by order number or table'
          placeholder='Order number or table'
          className='col-span-2 sm:w-56'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <p className='text-destructive text-sm'>{errorMessage(error)}</p>
      ) : isPending || !first || !store ? (
        <Skeleton className='h-64' role='status' aria-label='Loading orders' />
      ) : (
        <>
          <p className='text-sm'>
            <span className='font-medium'>
              {first.total} {first.total === 1 ? 'order' : 'orders'}
            </span>{' '}
            · {formatMoney(first.totals.gross_sales, store.currency)}
            {first.totals.cancelled_count > 0 && ` · ${first.totals.cancelled_count} cancelled`}
            <span className='text-muted-foreground'>
              {' '}
              ·{' '}
              {first.from === first.to
                ? formatDay(first.from)
                : `${formatDay(first.from)} – ${formatDay(first.to)}`}
            </span>
          </p>
          <Card className='py-0'>
            <CardContent className='px-0'>
              {rows.length === 0 ? (
                <p className='text-muted-foreground p-8 text-center text-sm'>No orders match.</p>
              ) : (
                <ul className='divide-y'>
                  {rows.map((o) => (
                    <Row
                      key={o.id}
                      order={o}
                      storeId={storeId}
                      currency={store.currency}
                      timeZone={store.timezone}
                      showDay={first.from !== first.to}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {hasNextPage && (
            <Button
              variant='outline'
              className='self-center'
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
