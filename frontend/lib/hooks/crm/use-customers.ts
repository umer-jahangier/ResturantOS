"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CrmRepository } from "@/lib/repositories/crm.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { CreateCustomerPayload } from "@/lib/models/crm.model";

/**
 * Customer search. Callers debounce the term; an empty term still queries (it lists the first
 * page), which is what the CRM grid wants on first paint.
 */
export function useCustomerSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.crm.customerSearch(q),
    queryFn: () => CrmRepository.searchCustomers(q),
    enabled,
    staleTime: 30_000,
  });
}

export function useCustomer(id: string | null) {
  return useQuery({
    queryKey: queryKeys.crm.customer(id ?? ""),
    queryFn: () => CrmRepository.getCustomer(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCustomerPayload) => CrmRepository.createCustomer(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crm.all() });
    },
  });
}

export function usePromotions() {
  return useQuery({
    queryKey: queryKeys.crm.promotions(),
    queryFn: () => CrmRepository.listPromotions(),
    staleTime: 60_000,
  });
}
