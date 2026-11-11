'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
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
