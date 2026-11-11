'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { formatMoney, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { AddCafeDialog } from './add-cafe';
import { useStoreId, useStores, type StoreHeader } from './api';
import { lastStoreId } from './last-store';

export function OnlineDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        online ? 'bg-emerald-500' : 'bg-muted-foreground/40',
        className
      )}
    />
  );
}

export const onlineText = (store: Pick<StoreHeader, 'online' | 'last_seen_at'>) =>
  store.online
    ? 'POS online'
    : store.last_seen_at
      ? `POS offline · seen ${timeAgo(store.last_seen_at)}`
      : 'POS not connected yet';

/** Above this many cafés the menu gets a search box. */
const SEARCH_FROM = 8;

/** Sidebar header: the open café, and a menu to open another one on the same page. */
export function StoreSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const storeId = useStoreId();
  const { data: stores } = useStores();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const onOutlets = pathname.startsWith('/dashboard/outlets');
  const current = onOutlets
    ? null
    : (stores?.find((s) => s.id === (storeId ?? lastStoreId())) ?? stores?.[0] ?? null);
  const many = (stores?.length ?? 0) > 1;
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? (stores ?? []).filter((s) => (s.name || 'Unnamed café').toLowerCase().includes(needle))
    : (stores ?? []);

  const open = (id: string) => {
    // Stay on the same kind of page (live orders, orders…) in the other café.
    const rest = storeId ? pathname.split('/').slice(3, 4).join('/') : '';
    router.push(`/dashboard/${id}${rest ? `/${rest}` : ''}`);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size='lg'
                aria-label='Switch café'
                className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
              />
            }
          >
            <div className='bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold'>
              {onOutlets ? (
                <Icons.outlets className='size-4' />
              ) : (
                (current?.name || 'R').slice(0, 1).toUpperCase()
              )}
            </div>
            <div className='grid flex-1 text-left leading-tight'>
              <span className='truncate font-semibold'>
                {onOutlets ? 'All outlets' : current?.name || 'Restrovia'}
              </span>
              <span className='text-muted-foreground flex items-center gap-1.5 truncate text-xs'>
                {onOutlets ? (
                  `${stores?.length ?? 0} cafés`
                ) : current ? (
                  <>
                    <OnlineDot online={current.online} />
                    {onlineText(current)}
                  </>
                ) : (
                  'Owner portal'
                )}
              </span>
            </div>
            {stores && stores.length > 0 && <Icons.chevronsUpDown className='ml-auto size-4' />}
          </DropdownMenuTrigger>
          {stores && stores.length > 0 && (
            <DropdownMenuContent className='w-(--anchor-width) min-w-64 rounded-lg' align='start'>
              {many && (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => router.push('/dashboard/outlets')}
                      className='gap-2'
                    >
                      <Icons.outlets className='size-4' />
                      <span className='flex-1'>All outlets</span>
                      {onOutlets && <Icons.check className='size-4' />}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Your cafés</DropdownMenuLabel>
              </DropdownMenuGroup>
              {(stores?.length ?? 0) >= SEARCH_FROM && (
                <div className='px-1 pb-1'>
                  <Input
                    aria-label='Find a café'
                    placeholder='Find a café'
                    className='h-8'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    // Letters would otherwise move the menu's highlight instead of typing.
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuGroup className='max-h-80 overflow-y-auto'>
                {shown.map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => open(s.id)} className='gap-2'>
                    <OnlineDot online={s.online} />
                    <span className='flex-1 truncate'>{s.name || 'Unnamed café'}</span>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {formatMoney(s.today.gross_sales, s.currency)}
                    </span>
                    {s.id === current?.id && <Icons.check className='size-4' />}
                  </DropdownMenuItem>
                ))}
                {shown.length === 0 && (
                  <p className='text-muted-foreground px-2 py-1.5 text-sm'>No café matches.</p>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setAdding(true)} className='gap-2'>
                  <Icons.add className='size-4' />
                  Add a café
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </SidebarMenuItem>
      <AddCafeDialog open={adding} onOpenChange={setAdding} />
    </SidebarMenu>
  );
}
