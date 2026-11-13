'use client';

import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import type {
  AdminRoleDetail,
  AdminUserDetail,
  OwnerDetail,
  StoreDetail,
  StoreHistory,
  TicketDetail
} from '@/features/admin/api';
import type { LeadDetail } from '@/features/leads/api';

type BreadcrumbItem = { title: string; link: string };

/** Names for path segments that aren't record ids. */
const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  overview: 'Overview',
  leads: 'Leads',
  board: 'Pipeline',
  tasks: 'My follow-ups',
  reports: 'Sales reports',
  stores: 'Stores',
  history: 'History',
  owners: 'Owners',
  plans: 'Plans',
  tickets: 'Support',
  admins: 'Users',
  roles: 'Roles',
  new: 'New',
  account: 'My account',
  'audit-log': 'Audit log'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where each detail page keeps its record, and the name to show for it. The breadcrumb reads the
 * data the page already loaded (any query whose key starts with one of `keys`), so it never makes
 * a request of its own.
 */
type RecordName = { keys: (id: string) => QueryKey[]; name: (data: never) => string };
const RECORDS: Record<string, RecordName> = {
  leads: {
    keys: (id) => [['lead', id]],
    name: (d: LeadDetail) => d.lead.businessName
  },
  stores: {
    keys: (id) => [
      ['store', id],
      ['store-history', id]
    ],
    name: (d: StoreDetail | StoreHistory) => d.store.name || 'Unnamed store'
  },
  owners: {
    keys: (id) => [['owner', id]],
    name: (d: OwnerDetail) => d.owner.name || d.owner.email
  },
  tickets: {
    keys: (id) => [['ticket', id]],
    name: (d: TicketDetail) =>
      String(d.ticket.context.subject ?? d.ticket.category ?? d.ticket.supportCode)
  },
  roles: {
    keys: (id) => [['admin-roles', id]],
    name: (d: AdminRoleDetail) => d.name
  },
  admins: {
    keys: (id) => [['admins', id]],
    name: (d: AdminUserDetail) => d.admin.name
  }
};

const label = (segment: string) =>
  SECTION_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');

/** The record's name once its page has loaded it; follows later loads and refreshes. */
function useLoadedName(record: RecordName | undefined, id: string | undefined) {
  const qc = useQueryClient();
  const read = () => {
    if (!record || !id) return undefined;
    for (const key of record.keys(id)) {
      const hit = qc.getQueriesData({ queryKey: key }).find(([, data]) => data !== undefined);
      if (hit) return record.name(hit[1] as never);
    }
    return undefined;
  };
  return useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    read,
    () => undefined
  );
}

export function useBreadcrumbs(): BreadcrumbItem[] {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const idAt = segments.findIndex((s) => UUID.test(s));
  const record = idAt > 0 ? RECORDS[segments[idAt - 1]!] : undefined;
  const name = useLoadedName(record, segments[idAt]);

  return segments.map((segment, index) => ({
    title: index === idAt ? (name ?? '…') : label(segment),
    link: `/${segments.slice(0, index + 1).join('/')}`
  }));
}
