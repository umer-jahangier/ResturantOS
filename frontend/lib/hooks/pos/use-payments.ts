"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import type { ApiError } from "@/lib/api-client/errors";
import type {
  VoidOrderPayload,
  RefundOrderPayload,
  RecordPaymentPayload,
  Order,
  OrderPayment,
} from "@/lib/models/pos.model";

const OFFLINE_ERROR =
  "This action requires a connection. Period lock, approvals and payments are processed online.";

// useRecordPayment/useVoidOrder/useRefundOrder are typed with the live `ApiError`
// (Layer-1 type import is allowed here — Layer-3 hooks — but NOT in components/**,
// FE-08 boundary). This lets the Charge page / VoidRefundDialog branch on `.status`/
// `.code` via TanStack's mutation type inference without importing the api-client
// class themselves (mirrors the existing use-login.ts/use-switch-branch.ts pattern,
// 04-02-C).
//
// networkMode: "always" on every mutation below: the default networkMode ("online")
// PAUSES mutationFn entirely while React Query's own onlineManager sees the browser
// offline — the `if (!isOnline) throw` guards in each mutationFn would then never run
// until reconnect, so OFFLINE_ERROR could never show promptly (same class of bug fixed
// in use-orders.ts's offline mutations; confirmed via 07.1-06 E2E). "always" lets each
// hook's own isOnline check (browser-event-driven, not React Query's manager) decide
// instead.

/** Payments-history read (POS-22, Charge page). Not offline-critical — server-authoritative. */
export function useOrderPayments(orderId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<OrderPayment[]>({
    queryKey: queryKeys.pos.orderPayments(branchId, orderId),
    queryFn: () => PosRepository.getPayments(orderId),
    enabled: isAuthenticated && !!branchId && !!orderId,
  });
}

/**
 * Records a single tender against the order (POS-23) — persists without closing; the
 * backend's `maybeCloseOrder` seam closes it only when this payment completes the order
 * AND it is already Served. Invalidates the order (status may flip to CLOSED) and the
 * payments-history list (POS-22) so the Charge page's amount-paid/remaining/chip and
 * history rows update immediately without a manual refresh.
 */
export function useRecordPayment(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<number, ApiError, RecordPaymentPayload>({
    // See the module-level networkMode comment above — same fix, same reason.
    networkMode: "always",
    mutationFn: (payload) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.recordPayment(orderId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.orderPayments(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}

export function useVoidOrder(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Order, ApiError, { payload: VoidOrderPayload; idempotencyKey: string }>({
    // See the module-level networkMode comment above — same fix, same reason.
    networkMode: "always",
    mutationFn: ({ payload, idempotencyKey }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.voidOrder(orderId, payload, idempotencyKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      // "order-summaries" is a DIFFERENT query-key segment than "orders" above —
      // useOrderSummaries (Order Management, POS-09/07.1-09) never re-fetched on
      // void without this, so a just-voided order would keep showing as active
      // until an unrelated refetch. Prefix-match invalidates every statuses-filter
      // cache entry.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}

export function useRefundOrder(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    // See the module-level networkMode comment above — same fix, same reason.
    networkMode: "always",
    mutationFn: ({ payload, idempotencyKey }: { payload: RefundOrderPayload; idempotencyKey: string }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.refundOrder(orderId, payload, idempotencyKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      // See the order-summaries invalidation note on useVoidOrder above.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
    },
  });
}
