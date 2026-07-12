"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import type { PurchaseOrderInput, VendorInput } from "@/lib/adapters/purchasing.adapter";
import type { PoStatus } from "@/lib/api-client/schemas/purchasing.schema";

const VENDORS_KEY = ["purchasing", "vendors"];
const POS_KEY = ["purchasing", "pos"];

function invalidatePo(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["purchasing", "po", id] });
  qc.invalidateQueries({ queryKey: POS_KEY });
}

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

/** 10-10: branch-scoped PO list, optionally narrowed by status. */
export function usePurchaseOrders(branchId: string, status?: PoStatus[]) {
  return useQuery({
    queryKey: [...POS_KEY, branchId, status ?? []],
    queryFn: () => PurchasingRepository.listPurchaseOrders(branchId, status),
    enabled: Boolean(branchId),
  });
}

/** Create a DRAFT purchase order. */
export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PurchaseOrderInput) => PurchasingRepository.createPurchaseOrder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: POS_KEY }),
  });
}

/** DRAFT -> PENDING_APPROVAL. */
export function useSubmitPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => PurchasingRepository.submitPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/** PENDING_APPROVAL -> DRAFT (requester pulls the PO back before it's decided). */
export function useWithdrawPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => PurchasingRepository.withdrawPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/**
 * PENDING_APPROVAL -> APPROVED (or stays PENDING_APPROVAL for the next tier). 10-07: a 403 here
 * can carry `APPROVAL_LIMIT_EXCEEDED` or `DUPLICATE_APPROVER` — components branch on
 * `error.code`/`error.status` via TanStack's mutation-error type inference (never import the
 * api-client directly, per the four-layer boundary).
 */
export function useApprovePurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => PurchasingRepository.approvePurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/** PENDING_APPROVAL -> REJECTED. `reason` is mandatory server-side. */
export function useRejectPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => PurchasingRepository.rejectPurchaseOrder(id, reason),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/** APPROVED -> SENT. */
export function useSendPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => PurchasingRepository.sendPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, id),
  });
}

export function useMockGrn(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: { poLineId: string; receivedQty: string }[]) =>
      PurchasingRepository.mockReceive(poId, lines),
    onSuccess: () => invalidatePo(qc, poId),
  });
}

/** PUR-02: close a FULLY_RECEIVED PO, or short-close a PARTIALLY_RECEIVED PO with a mandatory reason. */
export function useClosePurchaseOrder(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => PurchasingRepository.closePurchaseOrder(poId, reason),
    onSuccess: () => invalidatePo(qc, poId),
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
