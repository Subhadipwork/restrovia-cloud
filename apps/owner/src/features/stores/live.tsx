'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api-client';
import { formatMoney, formatTime, orderStatusLabel, orderTypeLabel, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { useLiveOrders, useStores, type LiveOrder, type LiveOrders } from './api';

const minutesOpen = (createdAt: string, at: number) =>
  Math.max(0, Math.round((at - Date.parse(createdAt)) / 60_000));

function SourceLine({ data }: { data: LiveOrders }) {
  if (data.source === 'live') {
    return (
      <span className='flex items-center gap-2'>
        <span
          className='inline-block size-2 animate-pulse rounded-full bg-emerald-500'
          aria-hidden='true'
        />
        Live from the POS · refreshes every 20 seconds
      </span>
    );
  }
  const synced = data.as_of ? `last synced ${timeAgo(data.as_of)}` : 'nothing synced yet';
  const why =
    data.reason === 'offline'
      ? 'The POS is offline'
      : data.reason === 'licence_inactive'
        ? 'Your licence has ended'
        : 'The POS didn’t answer';
  return (
    <span>
      {why}, so these are the open orders as {synced}.
    </span>
  );
}

function OrderCard({
  order,
  storeId,
  currency,
  timeZone,
  at
}: {
  order: LiveOrder;
  storeId: string;
  currency: string;
  timeZone: string;
  /** When this answer arrived; "open for" counts up to then. */
  at: number;
}) {
  const minutes = minutesOpen(order.created_at, at);
  const title = order.table
    ? `Table ${order.table}`
    : `#${order.order_number ?? order.pos_order_id}`;
  const card = (
    <Card className='h-full gap-3 py-4 transition-colors hover:bg-muted/40'>
      <CardHeader className='px-4'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <CardTitle className='text-base'>{title}</CardTitle>
            <p className='text-muted-foreground text-xs'>
              {order.table && order.order_number ? `#${order.order_number} · ` : ''}
              {orderTypeLabel(order.type, order.online_platform)} · since{' '}
              {formatTime(order.created_at, timeZone)}
            </p>
          </div>
          <Badge variant={order.status === 'ready' ? 'default' : 'secondary'}>
            {orderStatusLabel(order.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-2 px-4 text-sm'>
        <ul className='flex flex-col gap-0.5'>
          {order.items.map((item, i) => (
            <li
              key={i}
              className={cn(
                'flex justify-between gap-2',
                item.voided && 'text-muted-foreground line-through'
              )}
            >
              <span className='truncate'>
                {Number(item.quantity)} × {item.name}
              </span>
            </li>
          ))}
        </ul>
        <div className='flex items-center justify-between border-t pt-2'>
          <span
            className={cn(
              'text-xs',
              minutes >= 45 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'
            )}
          >
            Open {minutes} min
          </span>
          <span className='font-semibold tabular-nums'>{formatMoney(order.total, currency)}</span>
        </div>
      </CardContent>
    </Card>
  );
  return order.order_id ? (
    <Link href={`/dashboard/${storeId}/orders/${order.order_id}`} aria-label={`Open ${title}`}>
      {card}
    </Link>
  ) : (
    card
  );
}

export function LiveScreen({ storeId }: { storeId: string }) {
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const { data, error, isPending, dataUpdatedAt } = useLiveOrders(storeId);

  if (error) return <p className='text-destructive text-sm'>{errorMessage(error)}</p>;
  if (isPending || !data || !store) {
    return (
      <div
        className='flex flex-col gap-3'
        role='status'
        aria-label='Asking the POS for open orders'
      >
        <p className='text-muted-foreground text-sm'>Asking the POS for open orders…</p>
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className='h-40' />
          ))}
        </div>
      </div>
    );
  }

  const total = data.orders.reduce((sum, o) => sum + Number(o.total), 0);
  return (
    <div className='flex flex-col gap-4'>
      <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm'>
        <SourceLine data={data} />
        {data.orders.length > 0 && (
          <span className='text-foreground font-medium'>
            {data.orders.length} open · {formatMoney(total, store.currency)}
          </span>
        )}
      </div>
      {data.orders.length === 0 ? (
        <Card>
          <CardContent className='text-muted-foreground py-10 text-center text-sm'>
            No open orders right now.
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {data.orders.map((o) => (
            <OrderCard
              key={o.pos_order_id}
              order={o}
              storeId={storeId}
              currency={store.currency}
              timeZone={store.timezone}
              at={dataUpdatedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
