'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { AdminRole } from '@restrovia/shared';
import { adminApi, ApiError } from '@/lib/api-client';

export type Admin = { id: string; name: string; email: string; role: AdminRole };

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super admin',
  support: 'Support',
  sales: 'Sales'
};

export function useAdmin() {
  return useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => adminApi<{ admin: Admin }>('/auth/me').then((r) => r.admin),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000
  });
}

export function useHasRole(...roles: AdminRole[]) {
  const { data } = useAdmin();
  return !!data && roles.includes(data.role);
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
