"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type {
  ApPayment,
  ApPaymentInput,
  PurchaseOrder,
  PurchaseOrderInput,
  UpdateVendorItemInput,
  VendorCategoriesInput,
  VendorCategory,
  VendorInput,
  VendorInvoice,
  VendorInvoiceInput,
  VendorItem,
  VendorItemInput,
  VendorItemPrice,
  VendorItemPriceInput,
} from "@/lib/adapters/purchasing.adapter";
import type { InvoiceStatus, PoStatus } from "@/lib/api-client/schemas/purchasing.schema";
// Type-only import — permitted from a lib/hooks/** file (the ESLint layer-boundary rule only
// blocks components/**); this is how 04-02-C's "components branch on ApiError via TanStack
// mutation-error type inference" pattern works: the hook pins TError to ApiError, the component
// never imports api-client itself (see use-switch-branch.ts for the established precedent).
import type { ApiError } from "@/lib/api-client/errors";

function invalidatePo(qc: ReturnType<typeof useQueryClient>, branchId: string, id: string) {
  qc.invalidateQueries({ queryKey: queryKeys.purchasing.purchaseOrder(branchId, id) });
  qc.invalidateQueries({ queryKey: queryKeys.purchasing.purchaseOrders(branchId) });
}

/**
 * Invalidate BOTH the invoice detail key and the invoice list key on every invoice mutation — a
 * paid invoice that still shows MATCHED in the list is exactly the UAT bounce this plan calls out.
 * There is no `queryKeys.purchasing.invoice` (singular) factory in the registry, so the detail key
 * is built as a manual tuple that mirrors the registry's own `["purchasing", branchId, ...]` shape
 * — the same "fill a gap the registry didn't enumerate" pattern 08.2-12 used for stockLevels/search.
 */
function invalidateInvoice(qc: ReturnType<typeof useQueryClient>, branchId: string, id?: string) {
  if (id) qc.invalidateQueries({ queryKey: ["purchasing", branchId, "invoices", id] });
  qc.invalidateQueries({ queryKey: queryKeys.purchasing.invoices(branchId) });
}

export function useVendors() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.purchasing.vendors(branchId),
    queryFn: () => PurchasingRepository.listVendors(),
    enabled: isAuthenticated && !!branchId,
  });
}

/** PUR-01: create a vendor. `bankAccountNo` is encrypted server-side; only last4 comes back. */
export function useCreateVendor() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (input: VendorInput) => PurchasingRepository.createVendor(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendors(branchId) }),
  });
}

/** PUR-01: update a vendor. Omitting `bankAccountNo` leaves the stored account untouched. */
export function useUpdateVendor(id: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (input: VendorInput) => PurchasingRepository.updateVendor(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendors(branchId) }),
  });
}

// ── Vendor item catalog (PUR-07) ──────────────────────────────────────────────────────────────

/**
 * The data source the PO-line catalog picker (plan 08.2-19) scopes itself to once a vendor is
 * selected. `enabled` is false until `vendorId` is truthy — the PO line picker mounts before a
 * vendor is chosen and must not fire a request with an empty id (T-08.2-134).
 */
export function useVendorItems(vendorId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.purchasing.vendorItems(branchId, vendorId),
    queryFn: async () => (await PurchasingRepository.listVendorItems(vendorId)).data,
    enabled: isAuthenticated && !!branchId && Boolean(vendorId),
  });
}

export function useCreateVendorItem(vendorId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorItem, ApiError, VendorItemInput>({
    mutationFn: (input) => PurchasingRepository.createVendorItem(vendorId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendorItems(branchId, vendorId) }),
  });
}

export function useUpdateVendorItem(vendorId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorItem, ApiError, { vendorItemId: string; input: UpdateVendorItemInput }>({
    mutationFn: ({ vendorItemId, input }) => PurchasingRepository.updateVendorItem(vendorItemId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendorItems(branchId, vendorId) }),
  });
}

/** Archive is a catalog-row soft-delete — the underlying repository has no `del()` call. */
export function useArchiveVendorItem(vendorId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorItem, ApiError, string>({
    mutationFn: (vendorItemId) => PurchasingRepository.archiveVendorItem(vendorItemId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendorItems(branchId, vendorId) }),
  });
}

export function useVendorItemPrices(vendorItemId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.purchasing.vendorItemPrices(branchId, vendorItemId),
    queryFn: () => PurchasingRepository.listVendorItemPrices(vendorItemId),
    enabled: isAuthenticated && !!branchId && Boolean(vendorItemId),
  });
}

/**
 * Record a new vendor-item price. This is a CREATE, never an in-place price edit — no hook in
 * this file exposes any other way to write a vendor item's price (T-08.2-131). Invalidates the
 * item's price history, the vendor's catalog list (its row's current price changed) and the
 * vendor's price-change report.
 */
export function useRecordVendorItemPrice(vendorId: string, vendorItemId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorItemPrice, ApiError, VendorItemPriceInput>({
    mutationFn: (input) => PurchasingRepository.recordVendorItemPrice(vendorItemId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendorItemPrices(branchId, vendorItemId) });
      qc.invalidateQueries({ queryKey: queryKeys.purchasing.vendorItems(branchId, vendorId) });
      qc.invalidateQueries({ queryKey: ["purchasing", branchId, "vendors", vendorId, "price-changes"] });
    },
  });
}

/**
 * PUR-05/PUR-07 price-change report. No dedicated registry factory exists for this endpoint (a
 * gap 08.2-05 didn't enumerate, same class of gap as the invoice detail key above) — built as a
 * manual tuple that mirrors the real endpoint path (`/vendors/{vendorId}/price-changes`).
 */
export function useVendorPriceChanges(vendorId: string, since?: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: ["purchasing", branchId, "vendors", vendorId, "price-changes", since ?? null],
    queryFn: () => PurchasingRepository.listVendorPriceChanges(vendorId, since),
    enabled: isAuthenticated && !!branchId && Boolean(vendorId),
  });
}

/**
 * `queryKeys.purchasing.vendorCategories` only takes `branchId` (08.2-05 didn't enumerate a
 * vendorId dimension) — `vendorId` is appended as an extra tuple element, mirroring
 * `useStockLevels`'s `search` extension in `use-inventory.ts`.
 */
export function useVendorCategories(vendorId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: [...queryKeys.purchasing.vendorCategories(branchId), vendorId],
    queryFn: () => PurchasingRepository.listVendorCategories(vendorId),
    enabled: isAuthenticated && !!branchId && Boolean(vendorId),
  });
}

/** Category tags are filter/suggestion metadata only — replacing the set never touches authorization. */
export function useReplaceVendorCategories(vendorId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorCategory[], ApiError, VendorCategoriesInput>({
    mutationFn: (input) => PurchasingRepository.replaceVendorCategories(vendorId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...queryKeys.purchasing.vendorCategories(branchId), vendorId] }),
  });
}

// ── Purchase orders ────────────────────────────────────────────────────────────────────────────

export function usePurchaseOrder(id: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.purchasing.purchaseOrder(branchId, id),
    queryFn: () => PurchasingRepository.getPurchaseOrder(id),
    enabled: isAuthenticated && !!branchId && Boolean(id),
  });
}

/** 10-10: branch-scoped PO list, optionally narrowed by status. */
export function usePurchaseOrders(branchId: string, status?: PoStatus[]) {
  return useQuery({
    queryKey: queryKeys.purchasing.purchaseOrders(branchId, { status }),
    queryFn: () => PurchasingRepository.listPurchaseOrders(branchId, status),
    enabled: Boolean(branchId),
  });
}

/** Create a DRAFT purchase order. */
export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (input: PurchaseOrderInput) => PurchasingRepository.createPurchaseOrder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchasing.purchaseOrders(branchId) }),
  });
}

/** DRAFT -> PENDING_APPROVAL. */
export function useSubmitPurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PurchaseOrder, ApiError, void>({
    mutationFn: () => PurchasingRepository.submitPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, branchId, id),
  });
}

/** PENDING_APPROVAL -> DRAFT (requester pulls the PO back before it's decided). */
export function useWithdrawPurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PurchaseOrder, ApiError, void>({
    mutationFn: () => PurchasingRepository.withdrawPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, branchId, id),
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
  const { branchId } = useCurrentUser();
  return useMutation<PurchaseOrder, ApiError, void>({
    mutationFn: () => PurchasingRepository.approvePurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, branchId, id),
  });
}

/** PENDING_APPROVAL -> REJECTED. `reason` is mandatory server-side. */
export function useRejectPurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PurchaseOrder, ApiError, string>({
    mutationFn: (reason: string) => PurchasingRepository.rejectPurchaseOrder(id, reason),
    onSuccess: () => invalidatePo(qc, branchId, id),
  });
}

/** APPROVED -> SENT. */
export function useSendPurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<PurchaseOrder, ApiError, void>({
    mutationFn: () => PurchasingRepository.sendPurchaseOrder(id),
    onSuccess: () => invalidatePo(qc, branchId, id),
  });
}

export function useMockGrn(poId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (lines: { poLineId: string; receivedQty: string }[]) =>
      PurchasingRepository.mockReceive(poId, lines),
    onSuccess: () => invalidatePo(qc, branchId, poId),
  });
}

/** PUR-02: close a FULLY_RECEIVED PO, or short-close a PARTIALLY_RECEIVED PO with a mandatory reason. */
export function useClosePurchaseOrder(poId: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (reason?: string) => PurchasingRepository.closePurchaseOrder(poId, reason),
    onSuccess: () => invalidatePo(qc, branchId, poId),
  });
}

// ── Vendor invoices / AP ──────────────────────────────────────────────────────────────────────

export function useVendorInvoice(id: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: ["purchasing", branchId, "invoices", id],
    queryFn: () => PurchasingRepository.getInvoice(id),
    enabled: isAuthenticated && !!branchId && Boolean(id),
  });
}

/** 10-10: branch-scoped invoice list, optionally narrowed by status. */
export function useVendorInvoices(branchId: string, status?: InvoiceStatus[]) {
  return useQuery({
    queryKey: queryKeys.purchasing.invoices(branchId, { status }),
    queryFn: () => PurchasingRepository.listInvoices(branchId, status),
    enabled: Boolean(branchId),
  });
}

/** Book an invoice against a sent PO; the 3-way match runs synchronously server-side. */
export function useCreateVendorInvoice() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorInvoice, ApiError, VendorInvoiceInput>({
    mutationFn: (input) => PurchasingRepository.createInvoice(input),
    onSuccess: () => invalidateInvoice(qc, branchId),
  });
}

/** MISMATCHED -> APPROVED_FOR_PAYMENT, with a mandatory justification. */
export function useOverrideMatch(id: string) {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<VendorInvoice, ApiError, string>({
    mutationFn: (justification) => PurchasingRepository.overrideMatch(id, justification),
    onSuccess: () => invalidateInvoice(qc, branchId, id),
  });
}

/**
 * First frontend consumer of `POST /api/v1/purchasing/payments`. Invalidates the invoice list AND
 * the paid invoice's own detail key so a "MATCHED" row that was just paid shows PAID everywhere.
 */
export function useCreateApPayment() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ApPayment, ApiError, ApPaymentInput>({
    mutationFn: (input) => PurchasingRepository.createApPayment(input),
    onSuccess: (payment) => invalidateInvoice(qc, branchId, payment.allocations[0]?.invoiceId),
  });
}

/** PUR-06: spend aggregated by vendor and by category over [from, to], with a prior-period comparison. */
export function useSpendAnalytics(branchId: string, from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.purchasing.spendAnalytics(branchId, from, to),
    queryFn: () => PurchasingRepository.getSpendAnalytics(branchId, from, to),
    enabled: Boolean(branchId && from && to),
  });
}

/** PUR-05: vendor scorecard (on-time delivery, fill rate, price variance, total spend). */
export function useVendorScorecard(vendorId: string, branchId: string) {
  return useQuery({
    queryKey: queryKeys.purchasing.scorecard(branchId, vendorId),
    queryFn: () => PurchasingRepository.getVendorScorecard(vendorId, branchId),
    enabled: Boolean(vendorId && branchId),
  });
}
