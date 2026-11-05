'use client';

import { useAdmin } from '@/features/auth/use-admin';
import type { NavGroup, NavItem } from '@/types';

function allowed(item: NavItem, role: string | undefined) {
  return !item.access?.roles || (!!role && item.access.roles.some((r) => r === role));
}

export function useFilteredNavItems(items: NavItem[]) {
  const { data: admin } = useAdmin();
  return items.filter((item) => allowed(item, admin?.role));
}

export function useFilteredNavGroups(groups: NavGroup[]) {
  const { data: admin } = useAdmin();
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed(item, admin?.role)) }))
    .filter((group) => group.items.length > 0);
}
