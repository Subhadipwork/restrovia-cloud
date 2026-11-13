'use client';

import { type Admin, useAdmin } from '@/features/auth/use-admin';
import type { NavGroup, NavItem } from '@/types';

function allowed(item: NavItem, admin: Admin | undefined) {
  const needed = item.access?.permissions;
  return !needed || (!!admin && needed.every((p) => admin.permissions.includes(p)));
}

export function useFilteredNavItems(items: NavItem[]) {
  const { data: admin } = useAdmin();
  return items.filter((item) => allowed(item, admin));
}

export function useFilteredNavGroups(groups: NavGroup[]) {
  const { data: admin } = useAdmin();
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed(item, admin)) }))
    .filter((group) => group.items.length > 0);
}
