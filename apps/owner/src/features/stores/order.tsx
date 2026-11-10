'use client';

import Link from 'next/link';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, formatMoney, orderStatusLabel, orderTypeLabel } from '@/lib/display';
import { cn } from '@/lib/utils';
import { useOrder, useStores } from './api';

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'text-base font-semibold')}>
      <span className={strong ? undefined : 'text-muted-foreground'}>{label}</span>
      <span className='tabular-nums'>{value}</span>
    </div>
  );
}

export function OrderScreen({ storeId, orderId }: { storeId: string; orderId: string }) {
  const { data: stores } = useStores();
  const store = stores?.find((s) => s.id === storeId);
  const { data, error, isPending } = useOrder(storeId, orderId);

  const back = (
    <Button
      variant='ghost'
      size='sm'
      className='self-start'
      nativeButton={false}
      render={<Link href={`/dashboard/${storeId}/orders`} aria-label='Back to orders' />}
    >
      <Icons.chevronLeft /> Orders
    </Button>
  );
  if (error) {
    return (
      <div className='flex flex-col gap-3'>
        {back}
        <p className='text-destructive text-sm'>{errorMessage(error)}</p>
      </div>
    );
  }
  if (isPending || !data || !store)
    return <Skeleton className='h-96' role='status' aria-label='Loading order' />;

  const { order, items, bills } = data;
  const money = (v: string) => formatMoney(v, store.currency);
  const charges: [string, string][] = [
    ['Discount', order.discount],
    ['Packaging', order.packaging_charge],
    ['Delivery', order.delivery_charge],
    ['Service charge', order.service_charge],
    ['Round off', order.round_off]
  ];

  return (
    <div className='flex max-w-2xl flex-col gap-4'>
      {back}
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-start justify-between gap-2'>
            <CardTitle className='text-xl'>#{order.order_number ?? '—'}</CardTitle>
            <Badge variant={order.status === 'cancelled' ? 'destructive' : 'secondary'}>
              {orderStatusLabel(order.status)}
            </Badge>
          </div>
          <p className='text-muted-foreground text-sm'>
            {orderTypeLabel(order.type, order.online_platform)}
            {order.table && ` · Table ${order.table}`}
            {order.guests ? ` · ${order.guests} guests` : ''}
            {order.external_order_id && ` · ${order.external_order_id}`}
            <br />
            Opened {formatDateTime(order.created_at, store.timezone)}
            {order.completed_at &&
              ` · closed ${formatDateTime(order.completed_at, store.timezone)}`}
            {order.cancelled_at &&
              ` · cancelled ${formatDateTime(order.cancelled_at, store.timezone)}`}
          </p>
        </CardHeader>
        <CardContent className='flex flex-col gap-4 text-sm'>
          <ul className='flex flex-col gap-2'>
            {items.map((item, i) => (
              <li
                key={i}
                className={cn(
                  'flex justify-between gap-3',
                  item.voided && 'text-muted-foreground line-through'
                )}
              >
                <span>
                  {Number(item.quantity)} × {item.name}
                  {item.voided && <span className='ml-1 text-xs no-underline'>(removed)</span>}
                </span>
                <span className='tabular-nums'>{money(item.total)}</span>
              </li>
            ))}
          </ul>
          <div className='flex flex-col gap-1 border-t pt-3'>
            <Line label='Subtotal' value={money(order.subtotal)} />
            <Line label='Tax' value={money(order.tax)} />
            {charges
              .filter(([, v]) => Number(v) !== 0)
              .map(([label, v]) => (
                <Line
                  key={label}
                  label={label}
                  value={label === 'Discount' ? `− ${money(v)}` : money(v)}
                />
              ))}
            <Line label='Total' value={money(order.total)} strong />
            <Line label='Paid' value={money(order.paid)} />
          </div>
        </CardContent>
      </Card>

      {bills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{bills.length === 1 ? 'Bill' : `Bills (${bills.length})`}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='flex flex-col divide-y text-sm'>
              {bills.map((b, i) => (
                <li key={i} className='flex items-center justify-between gap-3 py-2'>
                  <div>
                    <div className='font-medium'>
                      {b.bill_number ?? 'Bill'}
                      {b.split_label && (
                        <span className='text-muted-foreground'> · {b.split_label}</span>
                      )}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {b.paid_at ? `Paid ${formatDateTime(b.paid_at, store.timezone)}` : 'Not paid'}
                      {Number(b.balance) > 0 && ` · ${money(b.balance)} due`}
                    </div>
                  </div>
                  <span className='font-medium tabular-nums'>{money(b.total)}</span>
                </li>
              ))}
            </ul>
            <p className='text-muted-foreground mt-3 text-xs'>
              Cash, UPI and card amounts come with the payments report.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
