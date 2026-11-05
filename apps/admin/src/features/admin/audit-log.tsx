'use client';

import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/display';
import { useAuditLog } from './api';
import { EmptyRow, Pager, QueryState } from './ui';

const PER_PAGE = 50;

export function AuditLogScreen() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    action: parseAsString.withDefault('')
  });
  const { data, isPending, error } = useAuditLog({
    action: params.action || undefined,
    page: params.page,
    per_page: PER_PAGE
  });

  return (
    <div className='flex flex-col gap-4'>
      <NativeSelect
        aria-label='Action'
        value={params.action}
        onChange={(e) => void setParams({ action: e.target.value, page: 1 })}
      >
        <NativeSelectOption value=''>All actions</NativeSelectOption>
        {data?.actions.map((a) => (
          <NativeSelectOption key={a} value={a}>
            {a}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.length === 0 && <EmptyRow colSpan={5}>Nothing recorded yet.</EmptyRow>}
                {data.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='text-sm whitespace-nowrap'>
                      {formatDateTime(r.created_at)}
                    </TableCell>
                    <TableCell className='text-sm'>
                      {r.admin_name ?? '—'}
                      <div className='text-muted-foreground text-xs'>{r.ip}</div>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>{r.action}</TableCell>
                    <TableCell className='text-xs'>
                      {r.target_type ? `${r.target_type} ${r.target_id?.slice(0, 8)}` : '—'}
                    </TableCell>
                    <TableCell
                      className='text-muted-foreground max-w-xs truncate font-mono text-xs'
                      title={JSON.stringify(r.details)}
                    >
                      {Object.keys(r.details).length ? JSON.stringify(r.details) : ''}
                    </TableCell>
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
