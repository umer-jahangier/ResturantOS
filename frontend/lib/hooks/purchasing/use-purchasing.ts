"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import type { VendorInput } from "@/lib/adapters/purchasing.adapter";

const VENDORS_KEY = ["purchasing", "vendors"];

export function useVendors() {
  return useQuery({ queryKey: VENDORS_KEY, queryFn: () => PurchasingRepository.listVendors() });
}

/** PUR-01: create a vendor. `bankAccountNo` is encrypted server-side; only last4 comes back. */
export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VendorInput) => PurchasingRepository.createVendor(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDORS_KEY }),
  });
}

/** PUR-01: update a vendor. Omitting `bankAccountNo` leaves the stored account untouched. */
export function useUpdateVendor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VendorInput) => PurchasingRepository.updateVendor(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDORS_KEY }),
  });
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

/** PUR-02: close a FULLY_RECEIVED PO, or short-close a PARTIALLY_RECEIVED PO with a mandatory reason. */
export function useClosePurchaseOrder(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => PurchasingRepository.closePurchaseOrder(poId, reason),
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
