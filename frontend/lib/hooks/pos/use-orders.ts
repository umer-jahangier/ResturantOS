"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { AddItemPayload, ApplyDiscountPayload, CreateOrderPayload } from "@/lib/models/pos.model";

export function useOrders(statuses?: string[]) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.orders(branchId, statuses),
    queryFn: () => PosRepository.listOrders({ branchId, status: statuses }),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useOrder(orderId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.order(branchId, orderId),
    queryFn: () => PosRepository.getOrder(orderId, branchId),
    enabled: isAuthenticated && !!branchId && !!orderId,
  });
}

export function useTables() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.tables(branchId),
    queryFn: () => PosRepository.getTables(branchId),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (payload: CreateOrderPayload) =>
      PosRepository.createOrder({ ...payload, clientOrderId: payload.clientOrderId ?? crypto.randomUUID() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
    },
  });
}

export function useAddItem(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (payload: AddItemPayload) => PosRepository.addItem(orderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
    },
  });
}

export function useRemoveItem(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (itemId: string) => PosRepository.removeItem(orderId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
    },
  });
}

export function useApplyDiscount(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (payload: ApplyDiscountPayload) => PosRepository.applyDiscount(orderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
    },
  });
}

export function useSendToKds(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: () => PosRepository.sendToKds(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}
