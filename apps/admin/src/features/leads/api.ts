'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LeadBusinessType,
  LeadCallOutcome,
  LeadLostReason,
  LeadManualActivityType,
  LeadSource,
  LeadStage,
  LeadTaskType,
  LeadTemperature
} from '@restrovia/shared';
import type { Paged } from '@/features/admin/api';
import { adminApi } from '@/lib/api-client';

export type LeadRow = {
  id: string;
  business_name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  stage: LeadStage;
  temperature: LeadTemperature;
  source: LeadSource;
  assigned_admin_id: string | null;
  assigned_admin_name: string | null;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  expected_value: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type Lead = {
  id: string;
  businessName: string;
  contactName: string | null;
  phoneE164: string | null;
  altPhoneE164: string | null;
  email: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  businessType: LeadBusinessType | null;
  outletCount: number;
  currentPos: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  stage: LeadStage;
  temperature: LeadTemperature;
  assignedAdminId: string | null;
  interestedPlanId: string | null;
  expectedValue: string | null;
  expectedCloseOn: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  storeId: string | null;
  lostReason: LeadLostReason | null;
  wonAt: string | null;
  lostAt: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type LeadTask = {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
  lead_stage: LeadStage;
  type: LeadTaskType;
  title: string;
  due_at: string;
  assigned_admin_id: string | null;
  assigned_admin_name: string | null;
  done_at: string | null;
};

export type DuplicateMatches = {
  leads: {
    id: string;
    business_name: string;
    city: string | null;
    phone: string | null;
    email: string | null;
    stage: LeadStage;
  }[];
  stores: { id: string; name: string; phone: string | null; email: string | null }[];
};

export type LeadDetail = {
  lead: Lead;
  assigned_admin_name: string | null;
  plan_name: string | null;
  created_by_name: string | null;
  open_tasks: LeadTask[];
  store: {
    id: string;
    name: string;
    status: string;
    phone: string | null;
    licence_status: string | null;
  } | null;
  duplicates: DuplicateMatches;
};

export type LeadActivity = {
  id: string;
  type: string;
  outcome: LeadCallOutcome | null;
  body: string;
  meta: Record<string, unknown>;
  occurred_at: string;
  admin_name: string | null;
};

export type Assignee = { id: string; name: string };

/** Fields the add and edit forms send; empty strings clear a field. */
export type LeadInput = {
  business_name: string;
  contact_name?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  business_type?: LeadBusinessType | null;
  outlet_count?: number;
  current_pos?: string | null;
  source: LeadSource;
  source_detail?: string | null;
  temperature?: LeadTemperature;
  interested_plan_id?: string | null;
  expected_value?: string | null;
  expected_close_on?: string | null;
  tags?: string[];
};

export type LeadFilters = {
  q?: string;
  stage?: string;
  assigned?: string;
  source?: string;
  temperature?: string;
  follow_up?: string;
  page: number;
  per_page: number;
};

export const useLeads = (q: LeadFilters) =>
  useQuery({
    queryKey: ['leads', q],
    queryFn: () => adminApi<Paged<LeadRow>>('/leads', { query: q }),
    placeholderData: keepPreviousData
  });

export const useLead = (id: string) =>
  useQuery({ queryKey: ['lead', id], queryFn: () => adminApi<LeadDetail>(`/leads/${id}`) });

export const useLeadActivities = (id: string, page: number) =>
  useQuery({
    queryKey: ['lead', id, 'activities', page],
    queryFn: () =>
      adminApi<Paged<LeadActivity>>(`/leads/${id}/activities`, {
        query: { page, per_page: 30 }
      }),
    placeholderData: keepPreviousData
  });

export const useAssignees = () =>
  useQuery({
    queryKey: ['lead-assignees'],
    queryFn: () => adminApi<Assignee[]>('/leads/assignees'),
    staleTime: 5 * 60_000
  });

/** Refreshes everything a lead change can affect. */
function useInvalidateLead(id?: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
    if (id) void qc.invalidateQueries({ queryKey: ['lead', id] });
  };
}

export function useCreateLead() {
  const invalidate = useInvalidateLead();
  return useMutation({
    mutationFn: (body: LeadInput & { assigned_admin_id?: string | null; force?: boolean }) =>
      adminApi<{ id: string }>('/leads', { method: 'POST', body }),
    onSuccess: invalidate
  });
}

export function useUpdateLead(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (body: Partial<LeadInput>) => adminApi(`/leads/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate
  });
}

export function useChangeStage(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (body: { stage: LeadStage; lost_reason?: LeadLostReason; note?: string }) =>
      adminApi(`/leads/${id}/stage`, { method: 'POST', body }),
    onSuccess: invalidate
  });
}

export function useAssignLead(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (adminId: string | null) =>
      adminApi(`/leads/${id}/assign`, { method: 'POST', body: { admin_id: adminId } }),
    onSuccess: invalidate
  });
}

export function useLinkStore(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (storeId: string | null) =>
      adminApi(`/leads/${id}/store`, { method: 'POST', body: { store_id: storeId } }),
    onSuccess: invalidate
  });
}

export function useDeleteLead(id: string) {
  const invalidate = useInvalidateLead();
  return useMutation({
    mutationFn: () => adminApi(`/leads/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate
  });
}

export function useAddActivity(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (body: {
      type: LeadManualActivityType;
      body: string;
      outcome?: LeadCallOutcome;
      duration_min?: number;
      occurred_at?: string;
    }) => adminApi(`/leads/${id}/activities`, { method: 'POST', body }),
    onSuccess: invalidate
  });
}

export function useAddTask(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (body: {
      type: LeadTaskType;
      title: string;
      due_at: string;
      assigned_admin_id?: string | null;
    }) => adminApi(`/leads/${id}/tasks`, { method: 'POST', body }),
    onSuccess: invalidate
  });
}

export function useUpdateTask(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: ({
      taskId,
      ...body
    }: {
      taskId: string;
      done?: boolean;
      due_at?: string;
      log?: { body: string; outcome?: LeadCallOutcome };
    }) => adminApi(`/lead-tasks/${taskId}`, { method: 'PATCH', body }),
    onSuccess: invalidate
  });
}

export function useDeleteTask(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (taskId: string) => adminApi(`/lead-tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: invalidate
  });
}

export type BoardCard = {
  id: string;
  business_name: string;
  city: string | null;
  area: string | null;
  stage: LeadStage;
  temperature: LeadTemperature;
  expected_value: string | null;
  next_follow_up_at: string | null;
  assigned_admin_name: string | null;
  store_id: string | null;
};
export type Board = {
  columns: { stage: LeadStage; count: number; value: string; cards: BoardCard[] }[];
  closed_since: string;
};

export const useBoard = (q: { assigned?: string; source?: string; temperature?: string }) =>
  useQuery({
    queryKey: ['leads', 'board', q],
    queryFn: () => adminApi<Board>('/leads/board', { query: q }),
    placeholderData: keepPreviousData
  });

/** Moves a card on the board; the board updates at once and rolls back if the API refuses. */
export function useMoveCard() {
  const qc = useQueryClient();
  const invalidate = useInvalidateLead();
  return useMutation({
    mutationFn: (v: { id: string; stage: LeadStage; lost_reason?: LeadLostReason }) =>
      adminApi(`/leads/${v.id}/stage`, {
        method: 'POST',
        body: { stage: v.stage, lost_reason: v.lost_reason }
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['leads', 'board'] });
      const snapshots = qc.getQueriesData<Board>({ queryKey: ['leads', 'board'] });
      for (const [key, board] of snapshots) {
        if (!board) continue;
        const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === v.id);
        if (!card) continue;
        const value = Number(card.expected_value ?? 0);
        qc.setQueryData<Board>(key, {
          ...board,
          columns: board.columns.map((col) => {
            if (col.stage === card.stage) {
              return {
                ...col,
                count: col.count - 1,
                value: String(Number(col.value) - value),
                cards: col.cards.filter((c) => c.id !== v.id)
              };
            }
            if (col.stage === v.stage) {
              return {
                ...col,
                count: col.count + 1,
                value: String(Number(col.value) + value),
                cards: [{ ...card, stage: v.stage }, ...col.cards]
              };
            }
            return col;
          })
        });
      }
      return { snapshots };
    },
    onError: (_err, _v, ctx) => {
      for (const [key, board] of ctx?.snapshots ?? []) qc.setQueryData(key, board);
    },
    onSettled: (_d, _e, v) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['lead', v.id] });
    }
  });
}

export const useLeadTasks = (q: { assigned?: string; due?: string }) =>
  useQuery({
    queryKey: ['lead-tasks', q],
    queryFn: () => adminApi<LeadTask[]>('/lead-tasks', { query: q }),
    refetchInterval: 60_000
  });

/** Completes, snoozes or logs a follow-up from a list that spans many leads. */
export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      ...body
    }: {
      taskId: string;
      leadId: string;
      done?: boolean;
      due_at?: string;
      log?: { body: string; outcome?: LeadCallOutcome };
    }) => {
      const { leadId: _leadId, ...rest } = body;
      return adminApi(`/lead-tasks/${taskId}`, { method: 'PATCH', body: rest });
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['lead', v.leadId] });
    }
  });
}

export type BulkAction =
  | { action: 'assign'; admin_id: string | null }
  | { action: 'stage'; stage: Exclude<LeadStage, 'won'>; lost_reason?: LeadLostReason }
  | { action: 'tag'; tag: string }
  | { action: 'delete' };

export function useBulkLeads() {
  const invalidate = useInvalidateLead();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkAction & { ids: string[] }) =>
      adminApi<{ ok: true; changed: number }>('/leads/bulk', { method: 'POST', body }),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['lead'] });
    }
  });
}

export type ImportResult = {
  total: number;
  valid: number;
  invalid: { row: number; issues: string[] }[];
  duplicates: { row: number; business_name: string; of: 'lead' | 'store' | 'file' }[];
  unknown_columns: string[];
  will_import: number;
  imported: number;
};

export function useImportLeads() {
  const invalidate = useInvalidateLead();
  return useMutation({
    mutationFn: (body: { csv: string; dry_run: boolean; include_duplicates: boolean }) =>
      adminApi<ImportResult>('/leads/import', { method: 'POST', body }),
    onSuccess: (_d, v) => {
      if (!v.dry_run) invalidate();
    }
  });
}

/** Address of the CSV download for the current filters; the browser sends the session cookie. */
export function exportUrl(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  return `/api/admin/leads/export.csv${qs ? `?${qs}` : ''}`;
}

export function useMergeLead(id: string) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (duplicateId: string) =>
      adminApi<{ ok: true; id: string }>(`/leads/${id}/merge`, {
        method: 'POST',
        body: { duplicate_id: duplicateId }
      }),
    onSuccess: invalidate
  });
}

export type LeadReport = {
  from: string;
  to: string;
  totals: {
    created: number;
    won: number;
    won_value: string;
    median_days_to_win: number | null;
  };
  funnel: { stage: LeadStage; count: number }[];
  by_source: { source: LeadSource; total: number; won: number; lost: number }[];
  lost_reasons: { reason: LeadLostReason | null; n: number }[];
  weekly: { week: string; source: LeadSource; n: number }[];
  by_admin: {
    id: string;
    name: string;
    open: number;
    won: number;
    activities: number;
    demos: number;
    overdue_tasks: number;
  }[];
};

export const useLeadReport = (from: string, to: string) =>
  useQuery({
    queryKey: ['leads', 'report', from, to],
    queryFn: () => adminApi<LeadReport>('/leads/reports', { query: { from, to } }),
    placeholderData: keepPreviousData,
    enabled: from <= to
  });

export type LeadSummary = {
  open: number;
  new_this_week: number;
  overdue: number;
  won_this_month: number;
};

export const useLeadSummary = (enabled: boolean) =>
  useQuery({
    queryKey: ['leads', 'summary'],
    queryFn: () => adminApi<LeadSummary>('/leads/summary'),
    enabled
  });
