import { NavGroup } from '@/types';

/** Sidebar and Cmd+K menu. `access.roles` hides an item from admins without one of those roles. */
export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        shortcut: ['d', 'd'],
        items: []
      }
    ]
  },
  {
    label: 'Customers',
    items: [
      { title: 'Stores', url: '/dashboard/stores', icon: 'store', shortcut: ['s', 's'], items: [] },
      { title: 'Owners', url: '/dashboard/owners', icon: 'teams', shortcut: ['o', 'o'], items: [] },
      {
        title: 'Plans',
        url: '/dashboard/plans',
        icon: 'billing',
        shortcut: ['p', 'p'],
        items: [],
        access: { roles: ['super_admin', 'sales'] }
      },
      {
        title: 'Support',
        url: '/dashboard/tickets',
        icon: 'support',
        shortcut: ['t', 't'],
        items: [],
        access: { roles: ['super_admin', 'support'] }
      }
    ]
  },
  {
    label: 'Team',
    items: [
      {
        title: 'Admins',
        url: '/dashboard/admins',
        icon: 'shield',
        shortcut: ['a', 'a'],
        items: [],
        access: { roles: ['super_admin'] }
      },
      {
        title: 'Audit log',
        url: '/dashboard/audit-log',
        icon: 'audit',
        shortcut: ['l', 'l'],
        items: [],
        access: { roles: ['super_admin'] }
      }
    ]
  }
];
