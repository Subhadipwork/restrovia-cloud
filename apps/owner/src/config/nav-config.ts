import { NavGroup } from '@/types';

/** Sidebar and Cmd+K menu. */
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
    label: 'Account',
    items: [
      {
        title: 'Profile',
        url: '/dashboard/account',
        icon: 'account',
        shortcut: ['p', 'p'],
        items: []
      },
      {
        title: 'Security',
        url: '/dashboard/account/security',
        icon: 'shield',
        shortcut: ['s', 's'],
        items: []
      }
    ]
  }
];
