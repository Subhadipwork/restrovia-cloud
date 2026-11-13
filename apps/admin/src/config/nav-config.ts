import { NavGroup } from '@/types';

/** Sidebar and Cmd+K menu. `access.permissions` hides an item from admins without all of them. */
export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        shortcut: ['d', 'd'],
        items: [],
        access: { permissions: ['overview.view'] },
      },
    ],
  },
  {
    label: 'Sales',
    items: [
      {
        title: 'Leads',
        url: '/dashboard/leads',
        icon: 'leads',
        shortcut: ['e', 'e'],
        items: [],
        access: { permissions: ['leads.view'] },
      },
      {
        title: 'Pipeline',
        url: '/dashboard/leads/board',
        icon: 'kanban',
        shortcut: ['b', 'b'],
        items: [],
        access: { permissions: ['leads.edit'] },
      },
      {
        title: 'My follow-ups',
        url: '/dashboard/leads/tasks',
        icon: 'followUps',
        shortcut: ['f', 'f'],
        items: [],
        access: { permissions: ['leads.edit'] },
      },
      {
        title: 'Sales reports',
        url: '/dashboard/leads/reports',
        icon: 'salesReports',
        shortcut: ['r', 'r'],
        items: [],
        access: { permissions: ['leads.reports'] },
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      {
        title: 'Stores',
        url: '/dashboard/stores',
        icon: 'store',
        shortcut: ['s', 's'],
        items: [],
        access: { permissions: ['stores.view'] },
      },
      {
        title: 'Owners',
        url: '/dashboard/owners',
        icon: 'teams',
        shortcut: ['o', 'o'],
        items: [],
        access: { permissions: ['owners.view'] },
      },
      {
        title: 'Plans',
        url: '/dashboard/plans',
        icon: 'billing',
        shortcut: ['p', 'p'],
        items: [],
        access: { permissions: ['plans.view'] },
      },
      {
        title: 'Support',
        url: '/dashboard/tickets',
        icon: 'support',
        shortcut: ['t', 't'],
        items: [],
        access: { permissions: ['tickets.view'] },
      },
    ],
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
        access: { permissions: ['users.view'] },
      },
      {
        title: 'Roles',
        url: '/dashboard/roles',
        icon: 'roles',
        shortcut: ['k', 'k'],
        items: [],
        access: { permissions: ['users.view'] },
      },
      {
        title: 'Audit log',
        url: '/dashboard/audit-log',
        icon: 'audit',
        shortcut: ['l', 'l'],
        items: [],
        access: { permissions: ['audit.view'] },
      },
    ],
  },
];
