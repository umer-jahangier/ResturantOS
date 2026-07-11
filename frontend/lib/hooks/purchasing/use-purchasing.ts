"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";

export function useVendors() {
  return useQuery({ queryKey: ["purchasing", "vendors"], queryFn: () => PurchasingRepository.listVendors() });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ["purchasing", "po", id],
    queryFn: () => PurchasingRepository.getPurchaseOrder(id),
    enabled: Boolean(id),
  });
}

export function useMockGrn(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: { poLineId: string; receivedQty: string }[]) =>
      PurchasingRepository.mockReceive(poId, lines),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchasing", "po", poId] }),
  });
}

export function useVendorInvoice(id: string) {
  return useQuery({
    queryKey: ["purchasing", "invoice", id],
    queryFn: () => PurchasingRepository.getInvoice(id),
    enabled: Boolean(id),
  });
}
