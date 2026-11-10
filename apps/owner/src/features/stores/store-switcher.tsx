'use client';

import { usePathname, useRouter } from 'next/navigation';
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { formatMoney, timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
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

/** Sidebar header: the open café, and a menu to open another one on the same page. */
export function StoreSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const storeId = useStoreId();
  const { data: stores } = useStores();
  const current = stores?.find((s) => s.id === (storeId ?? lastStoreId())) ?? stores?.[0] ?? null;

  const open = (id: string) => {
    // Stay on the same kind of page (live orders, orders…) in the other café.
    const rest = storeId ? pathname.split('/').slice(3, 4).join('/') : '';
    router.push(`/dashboard/${id}${rest ? `/${rest}` : ''}`);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
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
              {(current?.name || 'R').slice(0, 1).toUpperCase()}
            </div>
            <div className='grid flex-1 text-left leading-tight'>
              <span className='truncate font-semibold'>{current?.name || 'Restrovia'}</span>
              <span className='text-muted-foreground flex items-center gap-1.5 truncate text-xs'>
                {current ? (
                  <>
                    <OnlineDot online={current.online} />
                    {onlineText(current)}
                  </>
                ) : (
                  'Owner portal'
                )}
              </span>
            </div>
            {stores && stores.length > 1 && <Icons.chevronsUpDown className='ml-auto size-4' />}
          </DropdownMenuTrigger>
          {stores && stores.length > 0 && (
            <DropdownMenuContent className='w-(--anchor-width) min-w-64 rounded-lg' align='start'>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Your cafés</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {stores.map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => open(s.id)} className='gap-2'>
                    <OnlineDot online={s.online} />
                    <span className='flex-1 truncate'>{s.name || 'Unnamed café'}</span>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {formatMoney(s.today.gross_sales, s.currency)}
                    </span>
                    {s.id === current?.id && <Icons.check className='size-4' />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
