"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import type {
  ApPayment,
  ApPaymentInput,
  PurchaseOrder,
  PurchaseOrderInput,
  VendorInput,
  VendorInvoice,
  VendorInvoiceInput,
} from "@/lib/adapters/purchasing.adapter";
import type { InvoiceStatus, PoStatus } from "@/lib/api-client/schemas/purchasing.schema";
// Type-only import — permitted from a lib/hooks/** file (the ESLint layer-boundary rule only
// blocks components/**); this is how 04-02-C's "components branch on ApiError via TanStack
// mutation-error type inference" pattern works: the hook pins TError to ApiError, the component
// never imports api-client itself (see use-switch-branch.ts for the established precedent).
import type { ApiError } from "@/lib/api-client/errors";

const VENDORS_KEY = ["purchasing", "vendors"];
const POS_KEY = ["purchasing", "pos"];
const INVOICES_KEY = ["purchasing", "invoices"];

function invalidatePo(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["purchasing", "po", id] });
  qc.invalidateQueries({ queryKey: POS_KEY });
}

/**
 * Invalidate BOTH the invoice detail key and the invoice list key on every invoice mutation — a
 * paid invoice that still shows MATCHED in the list is exactly the UAT bounce this plan calls out.
 */
function invalidateInvoice(qc: ReturnType<typeof useQueryClient>, id?: string) {
  if (id) qc.invalidateQueries({ queryKey: ["purchasing", "invoice", id] });
  qc.invalidateQueries({ queryKey: INVOICES_KEY });
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
  return useMutation<PurchaseOrder, ApiError, void>({
    mutationFn: () => PurchasingRepository.submitPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/** PENDING_APPROVAL -> DRAFT (requester pulls the PO back before it's decided). */
export function useWithdrawPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrder, ApiError, void>({
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
  return useMutation<PurchaseOrder, ApiError, void>({
    mutationFn: () => PurchasingRepository.approvePurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/** PENDING_APPROVAL -> REJECTED. `reason` is mandatory server-side. */
export function useRejectPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrder, ApiError, string>({
    mutationFn: (reason: string) => PurchasingRepository.rejectPurchaseOrder(id, reason),
    onSuccess: () => invalidatePo(qc, id),
  });
}

/** APPROVED -> SENT. */
export function useSendPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrder, ApiError, void>({
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

/** 10-10: branch-scoped invoice list, optionally narrowed by status. */
export function useVendorInvoices(branchId: string, status?: InvoiceStatus[]) {
  return useQuery({
    queryKey: [...INVOICES_KEY, branchId, status ?? []],
    queryFn: () => PurchasingRepository.listInvoices(branchId, status),
    enabled: Boolean(branchId),
  });
}

/** Book an invoice against a sent PO; the 3-way match runs synchronously server-side. */
export function useCreateVendorInvoice() {
  const qc = useQueryClient();
  return useMutation<VendorInvoice, ApiError, VendorInvoiceInput>({
    mutationFn: (input) => PurchasingRepository.createInvoice(input),
    onSuccess: () => invalidateInvoice(qc),
  });
}

/** MISMATCHED -> APPROVED_FOR_PAYMENT, with a mandatory justification. */
export function useOverrideMatch(id: string) {
  const qc = useQueryClient();
  return useMutation<VendorInvoice, ApiError, string>({
    mutationFn: (justification) => PurchasingRepository.overrideMatch(id, justification),
    onSuccess: () => invalidateInvoice(qc, id),
  });
}

/**
 * First frontend consumer of `POST /api/v1/purchasing/payments`. Invalidates the invoice list AND
 * the paid invoice's own detail key so a "MATCHED" row that was just paid shows PAID everywhere.
 */
export function useCreateApPayment() {
  const qc = useQueryClient();
  return useMutation<ApPayment, ApiError, ApPaymentInput>({
    mutationFn: (input) => PurchasingRepository.createApPayment(input),
    onSuccess: (payment) => invalidateInvoice(qc, payment.allocations[0]?.invoiceId),
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
