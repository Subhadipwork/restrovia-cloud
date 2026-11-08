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
