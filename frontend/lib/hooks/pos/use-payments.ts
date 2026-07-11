"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import type { ApiError } from "@/lib/api-client/errors";
import type { CloseOrderPayload, VoidOrderPayload, RefundOrderPayload, Order } from "@/lib/models/pos.model";

const OFFLINE_ERROR =
  "This action requires a connection. Period lock, approvals and payments are processed online.";

// useCloseOrder/useVoidOrder are typed with the live `ApiError` (Layer-1 type import is
// allowed here — Layer-3 hooks — but NOT in components/**, FE-08 boundary). This lets
// PaymentPanel/VoidRefundDialog branch on `.status`/`.code` via TanStack's mutation
// type inference without importing the api-client class themselves (mirrors the
// existing use-login.ts/use-switch-branch.ts pattern, 04-02-C).

export function useCloseOrder(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Order, ApiError, { payload: CloseOrderPayload; idempotencyKey: string }>({
    // Default networkMode ("online") PAUSES mutationFn entirely while React Query's
    // own onlineManager sees the browser offline — the `if (!isOnline) throw` below
    // would then never run until reconnect, so OFFLINE_ERROR could never show
    // promptly (same class of bug fixed in use-orders.ts's offline mutations;
    // confirmed via 07.1-06 E2E). "always" lets this hook's own isOnline check
    // (browser-event-driven, not React Query's manager) decide instead.
    networkMode: "always",
    mutationFn: ({ payload, idempotencyKey }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.closeOrder(orderId, payload, idempotencyKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}

export function useVoidOrder(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Order, ApiError, { payload: VoidOrderPayload; idempotencyKey: string }>({
    // See the networkMode comment on useCloseOrder above — same fix, same reason.
    networkMode: "always",
    mutationFn: ({ payload, idempotencyKey }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.voidOrder(orderId, payload, idempotencyKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}

export function useRefundOrder(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    // See the networkMode comment on useCloseOrder above — same fix, same reason.
    networkMode: "always",
    mutationFn: ({ payload, idempotencyKey }: { payload: RefundOrderPayload; idempotencyKey: string }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.refundOrder(orderId, payload, idempotencyKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
    },
  });
}
