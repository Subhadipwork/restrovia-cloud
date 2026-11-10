'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ownerApi, ApiError } from '@/lib/api-client';

export type Owner = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  email_verified: boolean;
  two_factor_enabled: boolean;
  two_factor_enabled_at: string | null;
  must_change_password: boolean;
  recovery_codes_left: number;
  created_at: string;
};

export const OWNER_QUERY_KEY = ['owner', 'me'];

export function useOwner() {
  return useQuery({
    queryKey: OWNER_QUERY_KEY,
    queryFn: () => ownerApi<{ owner: Owner }>('/me').then((r) => r.owner),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000
  });
}

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ownerApi('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      router.replace('/sign-in');
    }
  });
}
