import { NavGroup } from '@/types';

/** Sidebar and Cmd+K menu; the café pages need to know which café is open. */
export function navGroupsFor(storeId: string | undefined): NavGroup[] {
  const store = storeId ? `/dashboard/${storeId}` : '/dashboard/overview';
  return [
    {
      label: 'Café',
      items: [
        { title: 'Today', url: store, icon: 'dashboard', shortcut: ['t', 't'], items: [] },
        {
          title: 'Live orders',
          url: storeId ? `${store}/live` : store,
          icon: 'clock',
          shortcut: ['l', 'l'],
          items: []
        },
        {
          title: 'Orders',
          url: storeId ? `${store}/orders` : store,
          icon: 'post',
          shortcut: ['o', 'o'],
          items: []
        },
        {
          title: 'Reports',
          url: storeId ? `${store}/reports` : store,
          icon: 'trendingUp',
          shortcut: ['r', 'r'],
          items: []
        },
        {
          title: 'Café details',
          url: storeId ? `${store}/details` : store,
          icon: 'store',
          shortcut: ['c', 'd'],
          items: []
        },
        {
          title: 'POS status',
          url: storeId ? `${store}/status` : store,
          icon: 'laptop',
          shortcut: ['p', 's'],
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
}
