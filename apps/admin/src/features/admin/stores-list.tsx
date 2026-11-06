'use client';

import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useDebounce } from '@/hooks/use-debounce';
import { formatDay, LICENCE_LABELS, licenceTone, storeCode, timeAgo } from '@/lib/display';
import { useStores } from './api';
import { EmptyRow, Pager, QueryState } from './ui';

const PER_PAGE = 25;

export function StoresScreen() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    search: parseAsString.withDefault(''),
    licence: parseAsString.withDefault(''),
    status: parseAsString.withDefault('')
  });
  const [search, setSearch] = useState(params.search);
  const debounced = useDebounce(search, 400);
  useEffect(() => {
    if (debounced !== params.search) void setParams({ search: debounced, page: 1 });
  }, [debounced, params.search, setParams]);

  const { data, isPending, error } = useStores({
    search: params.search || undefined,
    licence: params.licence || undefined,
    status: params.status || undefined,
    page: params.page,
    per_page: PER_PAGE
  });

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap gap-2'>
        <Input
          aria-label='Search stores'
          placeholder='Search by name, phone, email, address or store code'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='w-full sm:max-w-sm'
        />
        <NativeSelect
          aria-label='Licence'
          value={params.licence}
          onChange={(e) => void setParams({ licence: e.target.value, page: 1 })}
        >
          <NativeSelectOption value=''>All licences</NativeSelectOption>
          {Object.entries(LICENCE_LABELS).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label='Store status'
          value={params.status}
          onChange={(e) => void setParams({ status: e.target.value, page: 1 })}
        >
          <NativeSelectOption value=''>All statuses</NativeSelectOption>
          <NativeSelectOption value='active'>Active</NativeSelectOption>
          <NativeSelectOption value='suspended'>Suspended</NativeSelectOption>
          <NativeSelectOption value='deleted'>Deleted</NativeSelectOption>
        </NativeSelect>
      </div>

      {!data ? (
        <QueryState isPending={isPending} error={error} />
      ) : (
        <>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>POS</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.length === 0 && (
                  <EmptyRow colSpan={5}>No stores match these filters.</EmptyRow>
                )}
                {data.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/stores/${s.id}`}
                        className='font-medium hover:underline'
                      >
                        {s.name || 'Unnamed store'}
                      </Link>
                      <div className='text-muted-foreground text-xs'>
                        <span className='font-mono'>{storeCode(s.id)}</span>
                        {[s.phone, s.address]
                          .filter(Boolean)
                          .map((v) => ` · ${v}`)
                          .join('')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className='flex items-center gap-2 text-sm'>
                        <span
                          className={`size-2 rounded-full ${s.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                          aria-hidden='true'
                        />
                        {s.online ? 'Online' : `Seen ${timeAgo(s.last_seen_at)}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={licenceTone(s.licence_status)}>
                        {LICENCE_LABELS[s.licence_status ?? 'none']}
                      </Badge>
                      {s.licence_ends_at && (
                        <div className='text-muted-foreground mt-1 text-xs'>
                          until {formatDay(s.licence_ends_at)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{s.app_version ?? '—'}</TableCell>
                    <TableCell className='text-sm'>{formatDay(s.created_at)}</TableCell>
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
