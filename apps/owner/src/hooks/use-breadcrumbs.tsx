'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useStores } from '@/features/stores/api';

type BreadcrumbItem = {
  title: string;
  link: string;
};

const STORE_PAGES: Record<string, string> = {
  live: 'Live orders',
  orders: 'Orders',
  status: 'POS status',
  details: 'Café details'
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Café name, then the page: "Blue Door Café / Orders / Order". */
export function useBreadcrumbs(): BreadcrumbItem[] {
  const pathname = usePathname();
  const { data: stores } = useStores();

  return useMemo(() => {
    const [, , first, page, detail] = pathname.split('/');
    if (first === 'account') {
      return [
        { title: 'Profile', link: '/dashboard/account' },
        ...(page === 'security' ? [{ title: 'Security', link: '/dashboard/account/security' }] : [])
      ];
    }
    if (!first || !UUID.test(first)) return [];
    const base = `/dashboard/${first}`;
    const name = stores?.find((s) => s.id === first)?.name || 'Café';
    const crumbs: BreadcrumbItem[] = [{ title: name, link: base }];
    if (page && STORE_PAGES[page])
      crumbs.push({ title: STORE_PAGES[page], link: `${base}/${page}` });
    if (page === 'orders' && detail)
      crumbs.push({ title: 'Order', link: `${base}/orders/${detail}` });
    return crumbs;
  }, [pathname, stores]);
}
