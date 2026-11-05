'use client';

import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, TICKET_LABELS, timeAgo } from '@/lib/display';
import { useAddNote, useTicket, useTickets, useUpdateTicket } from './api';
import { EmptyRow, Pager, QueryState } from './ui';

const PER_PAGE = 25;

export function TicketsScreen() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    status: parseAsString.withDefault('open')
  });
  const { data, isPending, error } = useTickets({
    status: params.status === 'all' ? undefined : params.status,
    page: params.page,
    per_page: PER_PAGE
  });

  return (
    <div className='flex flex-col gap-4'>
      <NativeSelect
        aria-label='Ticket status'
        value={params.status}
        onChange={(e) => void setParams({ status: e.target.value, page: 1 })}
      >
        {Object.entries(TICKET_LABELS).map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value='all'>All tickets</NativeSelectOption>
      </NativeSelect>
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.length === 0 && <EmptyRow colSpan={4}>No tickets here.</EmptyRow>}
                {data.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/tickets/${t.id}`}
                        className='font-medium hover:underline'
                      >
                        {t.subject || t.category || 'Support request'}
                      </Link>
                      <div className='text-muted-foreground font-mono text-xs'>
                        {t.support_code}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/dashboard/stores/${t.store_id}`} className='hover:underline'>
                        {t.store_name || 'Unnamed store'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'resolved' ? 'secondary' : 'outline'}>
                        {TICKET_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-sm'>{timeAgo(t.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={data.page}
            perPage={data.per_page}
            total={data.total}
            onPage={(page) => void setParams({ page })}
          />
        </>
      )}
    </div>
  );
}

const HIDDEN_CONTEXT = new Set(['subject', 'log_tail', 'diagnostics']);

export function TicketDetailScreen({ id }: { id: string }) {
  const { data, isPending, error } = useTicket(id);
  const update = useUpdateTicket(id);
  const addNote = useAddNote(id);
  const [note, setNote] = useState('');
  if (!data) return <QueryState isPending={isPending} error={error} rows={4} />;
  const { ticket } = data;
  const context = Object.entries(ticket.context).filter(
    ([k, v]) => !HIDDEN_CONTEXT.has(k) && v !== null && v !== ''
  );

  return (
    <div className='grid gap-4 lg:grid-cols-3'>
      <div className='flex flex-col gap-4 lg:col-span-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>
              {String(ticket.context.subject ?? ticket.category ?? 'Support request')}
            </CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <p className='text-sm whitespace-pre-wrap'>{ticket.message || 'No message.'}</p>
            {context.length > 0 && (
              <dl className='grid grid-cols-2 gap-2 text-sm'>
                {context.map(([k, v]) => (
                  <div key={k}>
                    <dt className='text-muted-foreground text-xs'>{k.replace(/_/g, ' ')}</dt>
                    <dd className='break-words'>
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Notes</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {data.notes.length === 0 && (
              <p className='text-muted-foreground text-sm'>No notes yet.</p>
            )}
            {data.notes.map((n) => (
              <div key={n.id} className='rounded-lg border p-3 text-sm'>
                <div className='text-muted-foreground mb-1 text-xs'>
                  {n.admin_name ?? 'Former admin'} · {formatDateTime(n.created_at)}
                </div>
                <p className='whitespace-pre-wrap'>{n.body}</p>
              </div>
            ))}
            <form
              className='flex flex-col gap-2'
              onSubmit={(e) => {
                e.preventDefault();
                addNote.mutate(note.trim(), {
                  onSuccess: () => setNote(''),
                  onError: (err) => toast.error(errorMessage(err))
                });
              }}
            >
              <Label htmlFor='note'>Add a note</Label>
              <Textarea
                id='note'
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={5000}
                placeholder='What you did or told the customer'
              />
              <Button
                type='submit'
                size='sm'
                className='self-start'
                disabled={!note.trim() || addNote.isPending}
              >
                {addNote.isPending ? 'Saving…' : 'Add note'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card className='self-start'>
        <CardHeader>
          <CardTitle className='text-base'>Details</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-4 text-sm'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='status'>Status</Label>
            <NativeSelect
              id='status'
              className='w-full'
              value={ticket.status}
              disabled={update.isPending}
              onChange={(e) =>
                update.mutate(
                  { status: e.target.value },
                  {
                    onSuccess: () => toast.success('Status updated'),
                    onError: (err) => toast.error(errorMessage(err))
                  }
                )
              }
            >
              {Object.entries(TICKET_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>Support code</div>
            <div className='font-mono'>{ticket.supportCode}</div>
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>Store</div>
            {data.store ? (
              <Link href={`/dashboard/stores/${data.store.id}`} className='hover:underline'>
                {data.store.name}
              </Link>
            ) : (
              '—'
            )}
            {data.store?.phone && <div className='text-muted-foreground'>{data.store.phone}</div>}
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>Received</div>
            {formatDateTime(ticket.createdAt)}
          </div>
          {ticket.resolvedAt && (
            <div>
              <div className='text-muted-foreground text-xs'>Resolved</div>
              {formatDateTime(ticket.resolvedAt)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
