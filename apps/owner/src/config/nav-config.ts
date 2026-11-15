import type { NavGroup, NavItem } from '@/types';

/**
 * Sidebar and Cmd+K menu; the café pages need to know which café is open. All outlets shows only
 * to people with two or more cafés, and Team only to the café's owners.
 */
export function navGroupsFor(
  storeId: string | undefined,
  storeCount = 0,
  isOwner = false
): NavGroup[] {
  const store = storeId ? `/dashboard/${storeId}` : '/dashboard/overview';
  const outlets: NavGroup[] =
    storeCount > 1
      ? [
          {
            label: 'Outlets',
            items: [
              {
                title: 'All outlets',
                url: '/dashboard/outlets',
                icon: 'outlets',
                shortcut: ['a', 'o'],
                items: []
              }
            ]
          }
        ]
      : [];
  return [
    ...outlets,
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
          title: 'Menu',
          url: storeId ? `${store}/menu` : store,
          icon: 'pizza',
          shortcut: ['m', 'm'],
          items: []
        },
        {
          title: 'Menus',
          url: storeId ? `${store}/menus` : store,
          icon: 'galleryVerticalEnd',
          shortcut: ['m', 'n'],
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
        },
        ...(storeId && isOwner
          ? [
              {
                title: 'Team',
                url: `${store}/team`,
                icon: 'teams',
                shortcut: ['t', 'm'],
                items: []
              } satisfies NavItem
            ]
          : [])
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
          title: 'Alerts',
          url: '/dashboard/account/alerts',
          icon: 'notification',
          shortcut: ['a', 'a'],
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
