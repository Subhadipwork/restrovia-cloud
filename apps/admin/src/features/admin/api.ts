'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPermission } from '@restrovia/shared';
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
    businessDayStart: string;
    createdAt: string;
    updatedAt: string;
  };
  devices: {
    id: string;
    device_name: string | null;
    platform: string | null;
    app_version: string | null;
    last_heartbeat_at: string | null;
    last_seen_at: string | null;
    active_orders: number;
    revoked_at: string | null;
    created_at: string;
    online: boolean;
    machine_bound: boolean;
    last_licence_at: string | null;
    last_ip: string | null;
  }[];
  licence_history: {
    id: string;
    status: string;
    plan_code: string | null;
    plan_name: string | null;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    grace_waived: boolean;
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
  members: {
    owner_id: string;
    name: string;
    email: string;
    phone: string | null;
    invited: boolean;
    role: string;
    since: string;
  }[];
  online_history: {
    window_days: number;
    devices: {
      device_id: string;
      recorded_since: string | null;
      online_seconds: number;
      uptime_pct: number | null;
    }[];
    periods: { device_id: string; started_at: string; last_seen_at: string }[];
  };
  backups: {
    last_success_at: string | null;
    recent: {
      id: number;
      device_id: string;
      destination: 'local' | 'google_drive' | 'other';
      status: 'success' | 'failed';
      file_name: string | null;
      size_bytes: number | null;
      error: string | null;
      occurred_at: string;
    }[];
  };
  activity: {
    id: number;
    action: string;
    admin_name: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }[];
  /** The open block while the store is blocked. */
  block: StoreBlock | null;
  block_history: StoreBlock[];
};

export type StoreBlock = {
  id: string;
  reason: string;
  blocked_at: string;
  lifted_at: string | null;
};

export type StoreHistory = {
  store: { id: string; name: string; status: string };
  from: string;
  to: string;
  days: 7 | 30 | 90;
  timezone: string;
  currency: string;
  online: {
    recorded_since: string | null;
    online_seconds: number;
    uptime_pct: number | null;
    by_day: {
      day: string;
      recorded: boolean;
      online_seconds: number;
      uptime_pct: number | null;
      sessions: number;
    }[];
  };
  orders: {
    totals: {
      orders: number;
      completed: number;
      cancelled: number;
      median_complete_seconds: number | null;
      avg_sync_seconds: number | null;
    };
    by_status: { status: string; count: number }[];
    by_day: {
      day: string;
      orders: number;
      completed: number;
      cancelled: number;
      avg_complete_seconds: number | null;
    }[];
  };
  sales: {
    totals: { gross_sales: string; bills_count: number; avg_bill: string; orders_count: number };
    previous: { gross_sales: string; bills_count: number; from: string; to: string };
    by_type: Record<string, { sales: string; count: number }>;
  };
  sales_by_day: { day: string; gross_sales: string; bills_count: number; avg_bill: string }[];
  hours: {
    busiest_hour: number | null;
    days_with_sales: number;
    hours: { hour: number; sales: string; average: string }[];
  };
  top_items: {
    totals: { revenue: string; quantity: string; products: number };
    items: { name: string; quantity: string; revenue: string; share: number }[];
  };
};

export type StoreStatusAction =
  | { action: 'block'; reason: string; notify_owners: boolean }
  | { action: 'unblock'; notify_owners: boolean };

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
  | { action: 'suspend'; immediate?: boolean; note?: string };

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
  role: string;
  role_id: string;
  role_name: string;
  status: 'invited' | 'active' | 'disabled';
  two_factor: boolean;
  last_login_at: string | null;
  invited_at: string | null;
  created_at: string;
  open_sessions: number;
  /** Whether the signed-in admin may change this person (not themselves, not above them). */
  manageable: boolean;
};

export type AdminSession = {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
};

export type AdminUserDetail = {
  admin: {
    id: string;
    name: string;
    email: string;
    role: string;
    role_id: string;
    role_name: string;
    permissions: AdminPermission[];
    status: AdminUser['status'];
    two_factor: boolean;
    last_login_at: string | null;
    invited_at: string | null;
    invited_by_name: string | null;
    password_changed_at: string | null;
    created_at: string;
  };
  manageable: boolean;
  sessions: AdminSession[];
  activity: {
    id: number;
    action: string;
    target_type: string | null;
    target_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }[];
};

export type MyAccount = {
  admin: {
    id: string;
    name: string;
    email: string;
    role_name: string;
    two_factor: boolean;
    last_login_at: string | null;
    password_changed_at: string | null;
    created_at: string;
  };
  sessions: (AdminSession & { current: boolean })[];
};

export type AdminRoleOption = {
  id: string;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: AdminPermission[];
  /** Whether the signed-in admin may give this role to someone. */
  assignable: boolean;
  /** Whether the signed-in admin may change this role's permissions. */
  editable: boolean;
  /** Super admin: every permission, always; can't be edited. */
  all_permissions: boolean;
  /** Active people with this role. */
  users: number;
  created_at: string;
  updated_at: string;
};

export type AdminRoleDetail = AdminRoleOption & {
  people: { id: string; name: string; email: string; status: 'active' | 'disabled' }[];
};

export type RoleInput = { name: string; description: string; permissions: AdminPermission[] };

export const useAdminRoles = () =>
  useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => adminApi<AdminRoleOption[]>('/admin-roles')
  });

export const useAdminRole = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-roles', id],
    queryFn: () => adminApi<AdminRoleDetail>(`/admin-roles/${id}`),
    enabled: !!id
  });

function useRoleMutation<TVars, TResult = AdminRoleOption>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-roles'] });
      void qc.invalidateQueries({ queryKey: ['admins'] });
      // Your own permissions change when you edit your own role.
      void qc.invalidateQueries({ queryKey: ['admin', 'me'] });
    }
  });
}

export const useCreateRole = () =>
  useRoleMutation((body: RoleInput) =>
    adminApi<AdminRoleOption>('/admin-roles', { method: 'POST', body })
  );

export const useUpdateRole = (id: string) =>
  useRoleMutation((body: Partial<RoleInput>) =>
    adminApi<AdminRoleOption>(`/admin-roles/${id}`, { method: 'PATCH', body })
  );

export const useDeleteRole = (id: string) =>
  useRoleMutation(() => adminApi<{ ok: true }>(`/admin-roles/${id}`, { method: 'DELETE' }));

export const useResetRole = (id: string) =>
  useRoleMutation(() => adminApi<AdminRoleOption>(`/admin-roles/${id}/reset`, { method: 'POST' }));

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

export const useStoreHistory = (id: string, days: number) =>
  useQuery({
    queryKey: ['store-history', id, days],
    queryFn: () => adminApi<StoreHistory>(`/stores/${id}/history`, { query: { days } }),
    placeholderData: keepPreviousData
  });

export const useStore = (id: string) =>
  useQuery({ queryKey: ['store', id], queryFn: () => adminApi<StoreDetail>(`/stores/${id}`) });

/** Plans on sale; with includeInactive, also plans that were turned off. */
export const usePlans = (includeInactive = false, enabled = true) =>
  useQuery({
    queryKey: ['plans', { includeInactive }],
    queryFn: () =>
      adminApi<Plan[]>('/plans', { query: includeInactive ? { include_inactive: 'true' } : {} }),
    enabled
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

/** Blocks or unblocks the store's cloud access; the result says how many owners were emailed. */
export function useChangeStoreStatus(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StoreStatusAction) =>
      adminApi<{ status: 'blocked' | 'active'; reason: string | null; notified: number }>(
        `/stores/${storeId}/status`,
        { method: 'POST', body }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['store', storeId] });
      void qc.invalidateQueries({ queryKey: ['stores'] });
    }
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

export type OwnerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'active' | 'disabled';
  invited: boolean;
  email_verified: boolean;
  two_factor_enabled: boolean;
  locked: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  stores_count: number;
};

export type OwnerDetail = {
  owner: Omit<OwnerRow, 'stores_count'>;
  stores: { id: string; name: string; role: string; since: string }[];
  security_events: { action: string; ip: string | null; user_agent: string | null; at: string }[];
};

export const useOwners = (q: { search?: string; page: number; per_page: number }) =>
  useQuery({
    queryKey: ['owners', q],
    queryFn: () => adminApi<Paged<OwnerRow>>('/owners', { query: q }),
    placeholderData: keepPreviousData
  });

export const useOwner = (id: string) =>
  useQuery({ queryKey: ['owner', id], queryFn: () => adminApi<OwnerDetail>(`/owners/${id}`) });

/** Support actions on an owner account; the API audits each one. */
export function useOwnerAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      reason
    }: {
      action: 'reset-2fa' | 'disable' | 'enable' | 'resend-invite';
      reason?: string;
    }) =>
      adminApi<OwnerDetail>(`/owners/${id}/${action}`, {
        method: 'POST',
        body: action === 'resend-invite' ? undefined : { reason }
      }),
    onSuccess: (detail) => {
      qc.setQueryData(['owner', id], detail);
      void qc.invalidateQueries({ queryKey: ['owners'] });
    }
  });
}

export function useSetOwnerPassword(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      adminApi<OwnerDetail>(`/owners/${id}/password`, { method: 'POST', body: { password } }),
    onSuccess: (detail) => {
      qc.setQueryData(['owner', id], detail);
      void qc.invalidateQueries({ queryKey: ['owners'] });
    }
  });
}

/** Creates the store's owner account and emails an invite, or links an existing account. */
export function useAddOwner(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; phone?: string; password?: string }) =>
      adminApi<{ owner_id: string; created: boolean; password_set: boolean }>(
        `/stores/${storeId}/owners`,
        {
          method: 'POST',
          body
        }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['store', storeId] });
      void qc.invalidateQueries({ queryKey: ['owners'] });
    }
  });
}

export function useRemoveOwner(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ownerId: string) =>
      adminApi(`/stores/${storeId}/owners/${ownerId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['store', storeId] });
      void qc.invalidateQueries({ queryKey: ['owners'] });
    }
  });
}

export const useAdmins = () =>
  useQuery({ queryKey: ['admins'], queryFn: () => adminApi<AdminUser[]>('/admins') });

export type AdminActionKind =
  | 'disable'
  | 'enable'
  | 'reset-2fa'
  | 'resend-invite'
  | 'cancel-invite'
  | 'send-password-reset'
  | 'end-sessions';

function useInvalidateAdmins() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admins'] });
    void qc.invalidateQueries({ queryKey: ['admin-roles'] });
  };
}

export function useAdminAction() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: AdminActionKind }) =>
      adminApi(`/admins/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate
  });
}

export const useAdminDetail = (id: string) =>
  useQuery({
    queryKey: ['admins', id],
    queryFn: () => adminApi<AdminUserDetail>(`/admins/${id}`)
  });

export function useInviteAdmin() {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: (body: { name: string; email: string; role: string }) =>
      adminApi<AdminUser>('/admins', { method: 'POST', body }),
    onSuccess: invalidate
  });
}

export function useUpdateAdmin(id: string) {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: (body: { name?: string; role?: string }) =>
      adminApi(`/admins/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate
  });
}

export function useEndAdminSession(adminId: string) {
  const invalidate = useInvalidateAdmins();
  return useMutation({
    mutationFn: (sessionId: string) =>
      adminApi(`/admins/${adminId}/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: invalidate
  });
}

export const useMyAccount = () =>
  useQuery({ queryKey: ['account'], queryFn: () => adminApi<MyAccount>('/account') });

function useAccountMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'me'] });
    }
  });
}

export const useRenameMe = () =>
  useAccountMutation((name: string) => adminApi('/account', { method: 'PATCH', body: { name } }));

export const useChangeMyPassword = () =>
  useAccountMutation((body: { current_password: string; new_password: string }) =>
    adminApi<{ ok: true; other_sessions_ended: number }>('/account/password', {
      method: 'POST',
      body
    })
  );

export type TwoFactorSetup = { setup_token: string; secret: string; otpauth_url: string };

export const useStartMyTwoFactor = () =>
  useMutation({
    mutationFn: () => adminApi<TwoFactorSetup>('/account/2fa/setup', { method: 'POST' })
  });

export const useEnableMyTwoFactor = () =>
  useAccountMutation((body: { setup_token: string; code: string }) =>
    adminApi('/account/2fa/enable', { method: 'POST', body })
  );

export const useDisableMyTwoFactor = () =>
  useAccountMutation((body: { password: string; code: string }) =>
    adminApi('/account/2fa/disable', { method: 'POST', body })
  );

export const useEndMySession = () =>
  useAccountMutation((id: string) => adminApi(`/account/sessions/${id}`, { method: 'DELETE' }));

export const useAuditLog = (q: {
  action?: string;
  admin_id?: string;
  target_id?: string;
  page: number;
  per_page: number;
}) =>
  useQuery({
    queryKey: ['audit', q],
    queryFn: () => adminApi<Paged<AuditRow> & { actions: string[] }>('/audit-log', { query: q }),
    placeholderData: keepPreviousData
  });
