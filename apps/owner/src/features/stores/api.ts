'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { ownerApi } from '@/lib/api-client';

export type StoreHeader = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  business_day_start: string;
  online: boolean;
  last_seen_at: string | null;
};

export type StoreSummary = StoreHeader & {
  role: 'owner' | 'manager';
  open_orders: number;
  today: { business_date: string; gross_sales: string; bills_count: number };
  licence: { status: 'trial' | 'active' | 'inactive'; ends_at: string };
};

export type DayTotals = {
  gross_sales: string;
  net_sales: string;
  orders_count: number;
  bills_count: number;
  cancelled_count: number;
  avg_bill: string;
};

export type Dashboard = {
  store: StoreHeader;
  business_date: string;
  is_today: boolean;
  totals: DayTotals;
  compare: {
    yesterday: DayTotals & { business_date: string; same_time: boolean };
    last_week: DayTotals & { business_date: string; same_time: boolean };
  };
  by_type: Record<string, { sales: string; count: number }>;
  hourly: { hour: number; sales: string; last_week: string }[];
  open_orders: number;
  data_as_of: string | null;
  licence: { status: 'trial' | 'active' | 'inactive'; ends_at: string };
};

export type StoreStatus = StoreHeader & {
  last_order_synced_at: string | null;
  devices: {
    id: string;
    name: string | null;
    platform: string | null;
    app_version: string | null;
    online: boolean;
    last_seen_at: string | null;
    last_heartbeat_at: string | null;
    live_connection: boolean;
    open_orders: number;
  }[];
};

export type StoreDetails = StoreStatus & {
  code: string;
  role: 'owner' | 'manager';
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  store_type: string;
  store_status: 'active' | 'suspended' | 'deleted';
  created_at: string;
  licence: {
    status: 'trial' | 'active' | 'inactive';
    plan_code: string | null;
    plan_name: string | null;
    ends_at: string;
    grace_ends_at: string;
  };
};

export type LiveOrder = {
  order_id: string | null;
  pos_order_id: number;
  order_number: string | null;
  type: string | null;
  online_platform: string | null;
  status: string | null;
  table: string | null;
  guests: number | null;
  total: string;
  paid: string;
  payment_status: string | null;
  created_at: string;
  items: {
    name: string;
    quantity: string;
    total: string;
    status: string | null;
    voided: boolean;
  }[];
};

export type LiveOrders = {
  source: 'live' | 'synced';
  reason: 'offline' | 'no_answer' | 'licence_inactive' | null;
  as_of: string | null;
  orders: LiveOrder[];
};

export type OrderRow = {
  id: string;
  pos_order_id: number;
  order_number: string | null;
  type: string | null;
  online_platform: string | null;
  status: string | null;
  table: string | null;
  items_count: number;
  total: string;
  paid: string;
  payment_status: string | null;
  created_at: string;
  business_date: string;
};

export type OrderPage = {
  from: string;
  to: string;
  page: number;
  per_page: number;
  total: number;
  totals: { gross_sales: string; cancelled_count: number };
  types: string[];
  data: OrderRow[];
};

export type OrderFilters = {
  from?: string;
  to?: string;
  type?: string;
  status?: string;
  q?: string;
};

export type OrderDetail = {
  order: {
    id: string;
    order_number: string | null;
    type: string | null;
    online_platform: string | null;
    external_order_id: string | null;
    status: string | null;
    table: string | null;
    guests: number | null;
    business_date: string;
    created_at: string;
    completed_at: string | null;
    cancelled_at: string | null;
    synced_at: string;
    subtotal: string;
    tax: string;
    discount: string;
    packaging_charge: string;
    delivery_charge: string;
    service_charge: string;
    round_off: string;
    total: string;
    paid: string;
    payment_status: string | null;
  };
  items: {
    name: string;
    sku: string | null;
    quantity: string;
    unit_price: string;
    total: string;
    status: string | null;
    voided: boolean;
  }[];
  bills: {
    bill_number: string | null;
    split_label: string | null;
    total: string;
    paid: string;
    balance: string;
    payment_status: string | null;
    paid_at: string | null;
  }[];
};

export type MenuVariant = {
  id: string;
  name: string;
  price: number;
  online_price: number | null;
  sku: string | null;
  barcode: string | null;
  sort_order: number;
  is_active: boolean;
};

export type MenuAddonGroup = {
  id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  min_selection: number;
  max_selection: number;
  allow_multiple_quantities: boolean;
  sort_order: number;
  is_active: boolean;
  options: {
    id: string;
    name: string;
    price: number;
    sort_order: number;
    is_active: boolean;
  }[];
};

export type MenuScheduleWindow = { days: number[]; start: string; end: string };

export type MenuItem = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  /** Only owners see what an item costs; managers get null. */
  cost: number | null;
  sku: string | null;
  barcode: string | null;
  tags: string | null;
  dietary_tags: string | null;
  image_url: string | null;
  track_inventory: boolean;
  stock_quantity: number;
  is_active: boolean;
  sort_order: number;
  variants: MenuVariant[];
  addon_group_ids: string[];
  schedule: MenuScheduleWindow[];
};

export type Menu = {
  has_menu: boolean;
  sync: {
    enabled: boolean;
    portal_editing: boolean;
    synced_at: string | null;
    pos_generated_at: string | null;
  };
  categories: {
    id: string;
    name: string;
    parent_id: string | null;
    sort_order: number;
    is_active: boolean;
    color: string | null;
    schedule: MenuScheduleWindow[];
  }[];
  items: MenuItem[];
  addon_groups: MenuAddonGroup[];
};

const query = (params: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
};

/** The store in the URL (/dashboard/[storeId]/…), or undefined on account pages. */
export function useStoreId(): string | undefined {
  return useParams<{ storeId?: string }>().storeId;
}

export const useStores = () =>
  useQuery({
    queryKey: ['owner', 'stores'],
    queryFn: () => ownerApi<{ stores: StoreSummary[] }>('/stores').then((r) => r.stores),
    refetchInterval: 60_000
  });

export const useStoreDetails = (storeId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'details'],
    queryFn: () => ownerApi<StoreDetails>(`/stores/${storeId}`)
  });

export const useStoreStatus = (storeId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'status'],
    queryFn: () => ownerApi<StoreStatus>(`/stores/${storeId}/status`),
    refetchInterval: 60_000
  });

export const useDashboard = (storeId: string, date: string | undefined) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'dashboard', date ?? 'today'],
    queryFn: () => ownerApi<Dashboard>(`/stores/${storeId}/dashboard${query({ date })}`),
    placeholderData: keepPreviousData,
    // Today keeps moving; earlier days don't.
    refetchInterval: date ? false : 60_000
  });

/** Refreshes every 20 s; React Query pauses it while the tab is hidden. */
export const useLiveOrders = (storeId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'live'],
    queryFn: () => ownerApi<LiveOrders>(`/stores/${storeId}/live`),
    refetchInterval: 20_000
  });

export const useOrders = (storeId: string, filters: OrderFilters) =>
  useInfiniteQuery({
    queryKey: ['owner', 'store', storeId, 'orders', filters],
    queryFn: ({ pageParam }) =>
      ownerApi<OrderPage>(`/stores/${storeId}/orders${query({ ...filters, page: pageParam })}`),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.per_page < last.total ? last.page + 1 : undefined,
    placeholderData: keepPreviousData
  });

export const useOrder = (storeId: string, orderId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'order', orderId],
    queryFn: () => ownerApi<OrderDetail>(`/stores/${storeId}/orders/${orderId}`)
  });

export type ReportRange = { from: string; to: string };
export type ReportGroup = 'day' | 'week' | 'month';
export type ReportName = 'sales' | 'items' | 'hours' | 'payments' | 'checks';

export type ReportTotals = {
  gross_sales: string;
  net_sales: string;
  tax_total: string;
  discount_total: string;
  avg_bill: string;
  orders_count: number;
  bills_count: number;
  cancelled_count: number;
};

export type SalesReport = ReportRange & {
  group: ReportGroup;
  totals: ReportTotals;
  previous: ReportTotals & ReportRange;
  by_type: Record<string, { sales: string; count: number }>;
  periods: (ReportTotals & { start: string; end: string; partial: boolean })[];
};

export type ItemsReport = ReportRange & {
  sort: 'revenue' | 'quantity';
  limit: number;
  totals: { revenue: string; quantity: string; products: number };
  items: { name: string; quantity: string; revenue: string; share: number }[];
};

export type HoursReport = ReportRange & {
  total_sales: string;
  days_with_sales: number;
  busiest_hour: number | null;
  hours: { hour: number; sales: string; average: string }[];
};

export type PaymentsReport = ReportRange & {
  available: boolean;
  reason: 'offline' | 'no_answer' | 'licence_inactive' | null;
  as_of: string | null;
  total: string;
  methods: { method: string; amount: string; count: number; percent: number }[];
};

type CheckOrder = {
  id: string;
  order_number: string | null;
  type: string | null;
  online_platform: string | null;
  table: string | null;
  business_date: string;
  created_at: string;
};

export type ChecksReport = ReportRange & {
  limit: number;
  orders_count: number;
  orders_total: string;
  cancelled: {
    count: number;
    value: string;
    share: number;
    by_day: { date: string; count: number; value: string }[];
    orders: (CheckOrder & { total: string; cancelled_at: string | null })[];
  };
  voided: {
    count: number;
    value: string;
    items: { name: string; quantity: string; value: string; times: number }[];
    lines: (CheckOrder & { name: string; quantity: string; value: string })[];
  };
  discounts: {
    count: number;
    total: string;
    share: number;
    orders: (CheckOrder & {
      total: string;
      discount: string;
      discount_type: string | null;
      discount_value: string | null;
    })[];
  };
};

type ReportParams = ReportRange & { group?: ReportGroup; sort?: string; q?: string };

const reportPath = (storeId: string, report: string, params: ReportParams) =>
  `/stores/${storeId}/reports/${report}${query(params)}`;

/** The report as a CSV file; a plain link works because the session cookie goes with it. */
export const reportCsvUrl = (storeId: string, report: ReportName, params: ReportParams) =>
  `/api/owner${reportPath(storeId, `${report}.csv`, params)}`;

export const useSalesReport = (storeId: string, range: ReportRange | null, group: ReportGroup) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'reports', 'sales', range, group],
    queryFn: () => ownerApi<SalesReport>(reportPath(storeId, 'sales', { ...range!, group })),
    enabled: !!range,
    placeholderData: keepPreviousData
  });

export const useItemsReport = (
  storeId: string,
  range: ReportRange | null,
  sort: 'revenue' | 'quantity',
  q: string | undefined
) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'reports', 'items', range, sort, q ?? ''],
    queryFn: () => ownerApi<ItemsReport>(reportPath(storeId, 'items', { ...range!, sort, q })),
    enabled: !!range,
    placeholderData: keepPreviousData
  });

export const useHoursReport = (storeId: string, range: ReportRange | null) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'reports', 'hours', range],
    queryFn: () => ownerApi<HoursReport>(reportPath(storeId, 'hours', range!)),
    enabled: !!range,
    placeholderData: keepPreviousData
  });

export const useChecksReport = (storeId: string, range: ReportRange | null) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'reports', 'checks', range],
    queryFn: () => ownerApi<ChecksReport>(reportPath(storeId, 'checks', range!)),
    enabled: !!range,
    placeholderData: keepPreviousData
  });

/** Asked from the café computer, so it isn't refetched behind the owner's back. */
export const usePaymentsReport = (storeId: string, range: ReportRange | null) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'reports', 'payments', range],
    queryFn: () => ownerApi<PaymentsReport>(reportPath(storeId, 'payments', range!)),
    enabled: !!range,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false
  });

type DaySales = { business_date: string; gross_sales: string; bills_count: number };

export type OutletRow = StoreSummary & {
  /** The same day last week, up to the time of day today has reached. */
  last_week: DaySales;
  range: ReportTotals;
};

export type OutletsReport = ReportRange & {
  outlets: OutletRow[];
  /** One entry per currency; cafés in different currencies are never added together. */
  totals: {
    currency: string;
    outlets: number;
    open_orders: number;
    today: { gross_sales: string; bills_count: number };
    last_week: { gross_sales: string; bills_count: number };
    range: ReportTotals;
  }[];
};

export const outletsCsvUrl = (range: ReportRange) => `/api/owner/outlets.csv${query(range)}`;

export const useOutlets = (range: ReportRange | null) =>
  useQuery({
    queryKey: ['owner', 'outlets', range],
    queryFn: () => ownerApi<OutletsReport>(`/outlets${query(range!)}`),
    enabled: !!range,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000
  });

export const useMenu = (storeId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'menu'],
    queryFn: () => ownerApi<Menu>(`/stores/${storeId}/menu`),
    refetchInterval: 60_000
  });

/** Sold out or available again; the menu changes only after the POS says it did it. */
export const useSetAvailability = (storeId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, available }: { itemId: string; available: boolean }) =>
      ownerApi<{ id: string; is_active: boolean }>(
        `/stores/${storeId}/menu/items/${encodeURIComponent(itemId)}/availability`,
        { method: 'POST', body: { available } }
      ),
    onSuccess: ({ id, is_active }) => {
      queryClient.setQueryData<Menu>(['owner', 'store', storeId, 'menu'], (menu) =>
        menu
          ? { ...menu, items: menu.items.map((i) => (i.id === id ? { ...i, is_active } : i)) }
          : menu
      );
    }
  });
};

export type MenuEntity = 'item' | 'category' | 'addon_group' | 'addon';

export type MenuChange = {
  id: string;
  entity: MenuEntity;
  op: 'create' | 'update' | 'delete';
  entity_id: string | null;
  label: string;
  /** update: `{ field: { from, to } }`; create: `{ field: value }`. */
  fields: Record<string, unknown>;
  status: 'draft' | 'pending' | 'applied' | 'conflict' | 'rejected' | 'expired';
  requested_by: string;
  result: { error?: string; current?: Record<string, unknown> } | null;
  created_at: string;
  published_at: string | null;
  answered_at: string | null;
};

export type MenuDraftInput =
  | { op: 'create'; entity: MenuEntity; fields: Record<string, unknown> }
  | {
      op: 'update';
      entity: MenuEntity;
      entity_id: string;
      fields: Record<string, unknown>;
    }
  | { op: 'delete'; entity: MenuEntity; entity_id: string };

export type BulkAction =
  | { type: 'price_percent'; value: number }
  | { type: 'price_amount'; value: number }
  | { type: 'set_active'; value: boolean }
  | { type: 'move_category'; value: string | null };

export type ImportRow = {
  name: string;
  category?: string;
  price?: number;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  available?: boolean;
};

export const useMenuChanges = (storeId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'menu', 'changes'],
    queryFn: () =>
      ownerApi<{ changes: MenuChange[] }>(`/stores/${storeId}/menu/changes`).then((r) => r.changes),
    // Waiting changes are answered by the POS; check often enough to show the result.
    refetchInterval: 15_000
  });

export function useMenuDrafts(storeId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['owner', 'store', storeId, 'menu'] });
  return {
    add: useMutation({
      mutationFn: (input: MenuDraftInput) =>
        ownerApi(`/stores/${storeId}/menu/changes`, { method: 'POST', body: input }),
      onSuccess: refresh
    }),
    discard: useMutation({
      mutationFn: (id: string) =>
        ownerApi(`/stores/${storeId}/menu/changes/${id}`, { method: 'DELETE' }),
      onSuccess: refresh
    }),
    revert: useMutation({
      mutationFn: (id: string) =>
        ownerApi(`/stores/${storeId}/menu/changes/${id}/revert`, { method: 'POST' }),
      onSuccess: refresh
    }),
    duplicate: useMutation({
      mutationFn: (itemId: string) =>
        ownerApi(`/stores/${storeId}/menu/changes/duplicate`, {
          method: 'POST',
          body: { item_id: itemId }
        }),
      onSuccess: refresh
    }),
    bulk: useMutation({
      mutationFn: (body: { item_ids: string[]; action: BulkAction }) =>
        ownerApi<{ drafted: number; unchanged: number; skipped: number }>(
          `/stores/${storeId}/menu/changes/bulk`,
          { method: 'POST', body }
        ),
      onSuccess: refresh
    }),
    importRows: useMutation({
      mutationFn: (rows: ImportRow[]) =>
        ownerApi<{
          created: number;
          updated: number;
          unchanged: number;
          errors: { row: number; error: string }[];
        }>(`/stores/${storeId}/menu/changes/import`, { method: 'POST', body: { rows } }),
      onSuccess: refresh
    }),
    publish: useMutation({
      mutationFn: () =>
        ownerApi<{ published: number }>(`/stores/${storeId}/menu/changes/publish`, {
          method: 'POST'
        }),
      onSuccess: refresh
    })
  };
}

export type MenusList = {
  has_menu: boolean;
  base: { id: 'base'; name: string; item_count: number };
  menus: {
    id: string;
    name: string;
    built_in: boolean;
    priced_items: number;
    hidden_items: number;
  }[];
};

export type ChannelMenuItem = {
  id: string;
  name: string;
  category_id: string | null;
  is_active: boolean;
  base_price: number;
  /** This menu's own price, or null when it uses the Base Menu price. */
  price: number | null;
  effective_price: number;
  hidden: boolean;
  variants: {
    id: string;
    name: string;
    base_price: number;
    price: number | null;
    effective_price: number;
  }[];
};

export type ChannelMenu = {
  menu: { id: string; name: string };
  has_menu: boolean;
  categories: { id: string; name: string; sort_order: number }[];
  items: ChannelMenuItem[];
};

export const useMenus = (storeId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'menus'],
    queryFn: () => ownerApi<MenusList>(`/stores/${storeId}/menus`)
  });

export const useChannelMenu = (storeId: string, menuId: string) =>
  useQuery({
    queryKey: ['owner', 'store', storeId, 'menus', menuId],
    queryFn: () => ownerApi<ChannelMenu>(`/stores/${storeId}/menus/${menuId}`)
  });

export function useChannelMenuActions(storeId: string, menuId?: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['owner', 'store', storeId, 'menus'] });
  return {
    create: useMutation({
      mutationFn: (name: string) =>
        ownerApi<{ id: string; name: string }>(`/stores/${storeId}/menus`, {
          method: 'POST',
          body: { name }
        }),
      onSuccess: refresh
    }),
    remove: useMutation({
      mutationFn: (id: string) => ownerApi(`/stores/${storeId}/menus/${id}`, { method: 'DELETE' }),
      onSuccess: refresh
    }),
    reset: useMutation({
      mutationFn: (id: string) =>
        ownerApi(`/stores/${storeId}/menus/${id}/reset`, { method: 'POST' }),
      onSuccess: refresh
    }),
    setItem: useMutation({
      mutationFn: ({
        itemId,
        body
      }: {
        itemId: string;
        body: {
          price?: number | null;
          hidden?: boolean;
          variants?: { variant_id: string; price: number | null }[];
        };
      }) =>
        ownerApi<{ item: ChannelMenuItem }>(`/stores/${storeId}/menus/${menuId}/items/${itemId}`, {
          method: 'PUT',
          body
        }),
      onSuccess: ({ item }) => {
        queryClient.setQueryData<ChannelMenu>(
          ['owner', 'store', storeId, 'menus', menuId],
          (menu) =>
            menu ? { ...menu, items: menu.items.map((i) => (i.id === item.id ? item : i)) } : menu
        );
        queryClient.invalidateQueries({
          queryKey: ['owner', 'store', storeId, 'menus'],
          exact: true
        });
      }
    })
  };
}
