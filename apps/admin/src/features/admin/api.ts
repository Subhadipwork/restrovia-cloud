'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminRole } from '@restrovia/shared';
import { adminApi } from '@/lib/api-client';

export type Paged<T> = { data: T[]; total: number; page: number; per_page: number };

export type Overview = {
  stores: Record<string, number>;
  online_now: number;
  new_this_month: number;
  licences: Record<string, number>;
  versions: { version: string; count: number }[];
  open_tickets: number;
};

export type StoreRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  country: string | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  app_version: string | null;
  licence_status: string | null;
  licence_ends_at: string | null;
  online: boolean;
};

export type StoreDetail = {
  store: {
    id: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
    currency: string | null;
    timezone: string;
    address: string | null;
    storeType: string;
    status: string;
    createdAt: string;
  };
  devices: {
    id: string;
    device_name: string | null;
    platform: string | null;
    app_version: string | null;
    last_heartbeat_at: string | null;
    active_orders: number;
    revoked_at: string | null;
    created_at: string;
    online: boolean;
    machine_bound: boolean;
    last_licence_at: string | null;
  }[];
  licence_history: {
    id: string;
    status: string;
    plan_code: string | null;
    plan_name: string | null;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    notes: string | null;
    created_at: string;
  }[];
  payments: {
    id: string;
    amount: string;
    currency: string;
    method: string;
    status: string;
    paid_at: string;
  }[];
  tickets: {
    id: string;
    support_code: string;
    category: string | null;
    status: string;
    message: string;
    created_at: string;
  }[];
  stats: {
    business_date: string;
    gross_sales: string;
    bills_count: number;
    orders_count: number;
  }[];
  members: { owner_id: string; name: string; phone: string; role: string; since: string }[];
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  price: string;
  currency: string;
  interval: 'month' | 'year';
  max_devices: number;
  features: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  active_stores: number;
};

export type NewPlan = {
  code: string;
  name: string;
  price: string;
  interval: 'month' | 'year';
  max_devices: number;
};

export type PlanChanges = Partial<Pick<Plan, 'name' | 'price' | 'max_devices' | 'is_active'>>;

export type LicenceAction =
  | { action: 'extend_trial'; days: number; note?: string }
  | { action: 'activate'; plan_code: string; amount?: string; note?: string }
  | { action: 'suspend'; note?: string };

export type TicketRow = {
  id: string;
  support_code: string;
  store_id: string;
  store_name: string;
  category: string | null;
  subject: string | null;
  status: string;
  assigned_admin_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketDetail = {
  ticket: {
    id: string;
    supportCode: string;
    category: string | null;
    message: string;
    context: Record<string, unknown>;
    status: string;
    assignedAdminId: string | null;
    createdAt: string;
    resolvedAt: string | null;
  };
  store: { id: string; name: string; phone: string | null } | null;
  notes: { id: string; body: string; admin_name: string | null; created_at: string }[];
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  status: 'active' | 'disabled';
  two_factor: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type AuditRow = {
  id: number;
  action: string;
  admin_name: string | null;
  admin_email: string | null;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
};

export const useOverview = () =>
  useQuery({
    queryKey: ['overview'],
    queryFn: () => adminApi<Overview>('/overview'),
    refetchInterval: 60_000
  });

export const useStores = (q: {
  search?: string;
  status?: string;
  licence?: string;
  page: number;
  per_page: number;
}) =>
  useQuery({
    queryKey: ['stores', q],
    queryFn: () => adminApi<Paged<StoreRow>>('/stores', { query: q }),
    placeholderData: keepPreviousData
  });

export const useStore = (id: string) =>
  useQuery({ queryKey: ['store', id], queryFn: () => adminApi<StoreDetail>(`/stores/${id}`) });

/** Plans on sale; with includeInactive, also plans that were turned off. */
export const usePlans = (includeInactive = false) =>
  useQuery({
    queryKey: ['plans', { includeInactive }],
    queryFn: () =>
      adminApi<Plan[]>('/plans', { query: includeInactive ? { include_inactive: 'true' } : {} })
  });

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewPlan) => adminApi<Plan>('/plans', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plans'] })
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: PlanChanges }) =>
      adminApi<Plan>(`/plans/${id}`, { method: 'PATCH', body: changes }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plans'] })
  });
}

/** Lets a POS check in from a different computer (new PC or reinstalled Windows). */
export function useResetBinding(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      adminApi(`/stores/${storeId}/devices/${deviceId}/reset-binding`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['store', storeId] })
  });
}

export function useChangeLicence(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LicenceAction) =>
      adminApi(`/stores/${storeId}/licence`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['store', storeId] });
      void qc.invalidateQueries({ queryKey: ['stores'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    }
  });
}

export const useTickets = (q: { status?: string; page: number; per_page: number }) =>
  useQuery({
    queryKey: ['tickets', q],
    queryFn: () => adminApi<Paged<TicketRow>>('/tickets', { query: q }),
    placeholderData: keepPreviousData
  });

export const useTicket = (id: string) =>
  useQuery({ queryKey: ['ticket', id], queryFn: () => adminApi<TicketDetail>(`/tickets/${id}`) });

export function useUpdateTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status?: string; assigned_admin_id?: string | null }) =>
      adminApi(`/tickets/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ticket', id] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    }
  });
}

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      adminApi(`/tickets/${id}/notes`, { method: 'POST', body: { body } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ticket', id] })
  });
}

export const useAdmins = () =>
  useQuery({ queryKey: ['admins'], queryFn: () => adminApi<AdminUser[]>('/admins') });

export function useAdminAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'disable' | 'enable' | 'reset-2fa' }) =>
      adminApi(`/admins/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admins'] })
  });
}

export function useCreateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; role: AdminRole; password: string }) =>
      adminApi<AdminUser>('/admins', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admins'] })
  });
}

export const useAuditLog = (q: {
  action?: string;
  target_id?: string;
  page: number;
  per_page: number;
}) =>
  useQuery({
    queryKey: ['audit', q],
    queryFn: () => adminApi<Paged<AuditRow> & { actions: string[] }>('/audit-log', { query: q }),
    placeholderData: keepPreviousData
  });
