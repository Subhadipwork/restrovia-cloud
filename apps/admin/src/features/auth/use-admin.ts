'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { AdminPermission } from '@restrovia/shared';
import { adminApi, ApiError } from '@/lib/api-client';

export type Admin = {
  id: string;
  name: string;
  email: string;
  /** Role key, e.g. `support`; custom roles have their own. */
  role: string;
  role_name: string;
  permissions: AdminPermission[];
};

export function useAdmin() {
  return useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => adminApi<{ admin: Admin }>('/auth/me').then((r) => r.admin),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000
  });
}

/** True when the signed-in admin holds every one of these permissions. The API checks again. */
export function useCan(...permissions: AdminPermission[]) {
  const { data } = useAdmin();
  return !!data && permissions.every((p) => data.permissions.includes(p));
}

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      router.replace('/sign-in');
    }
  });
}
