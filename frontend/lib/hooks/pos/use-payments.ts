"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import type { CloseOrderPayload, VoidOrderPayload, RefundOrderPayload } from "@/lib/models/pos.model";

const OFFLINE_ERROR =
  "This action requires a connection. Period lock, approvals and payments are processed online.";

export function useCloseOrder(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CloseOrderPayload; idempotencyKey: string }) => {
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
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: VoidOrderPayload; idempotencyKey: string }) => {
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
