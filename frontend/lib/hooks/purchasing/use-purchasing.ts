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

/** PUR-06: spend aggregated by vendor and by category over [from, to], with a prior-period comparison. */
export function useSpendAnalytics(branchId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["purchasing", "analytics", "spend", branchId, from, to],
    queryFn: () => PurchasingRepository.getSpendAnalytics(branchId, from, to),
    enabled: Boolean(branchId && from && to),
  });
}

/** PUR-05: vendor scorecard (on-time delivery, fill rate, price variance, total spend). */
export function useVendorScorecard(vendorId: string, branchId: string) {
  return useQuery({
    queryKey: ["purchasing", "analytics", "scorecard", vendorId, branchId],
    queryFn: () => PurchasingRepository.getVendorScorecard(vendorId, branchId),
    enabled: Boolean(vendorId && branchId),
  });
}
