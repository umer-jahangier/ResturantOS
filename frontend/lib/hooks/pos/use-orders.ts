"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { enqueue } from "@/lib/offline/outbox";
import type {
  Order,
  AddItemPayload,
  ApplyDiscountPayload,
  CreateOrderPayload,
} from "@/lib/models/pos.model";

// ── Queries ───────────────────────────────────────────────────────────────────

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

// ── Mutations — offline-aware ─────────────────────────────────────────────────

export function useCreateOrder() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();

  return useMutation({
    mutationFn: async (payload: CreateOrderPayload): Promise<Order> => {
      const clientOrderId = payload.clientOrderId ?? crypto.randomUUID();

      if (!isOnline) {
        await enqueue({
          type: "CREATE_ORDER",
          clientOrderId,
          payload: { ...payload, clientOrderId },
        });
        // Return a local-only DRAFT stub so the UI renders immediately.
        return buildOfflineOrderStub(clientOrderId, branchId, payload);
      }

      return PosRepository.createOrder({ ...payload, clientOrderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
    },
  });
}

export function useAddItem(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();

  return useMutation({
    mutationFn: async (payload: AddItemPayload): Promise<Order> => {
      if (!isOnline) {
        // clientOrderId for APPEND_ITEMS is the server orderId (or local id when
        // the order was also created offline in this session).
        await enqueue({ type: "APPEND_ITEMS", clientOrderId: orderId, payload });
        // Return a minimal stub so the mutation resolves without an error.
        return buildOfflineOrderStub(orderId, branchId, { branchId, clientOrderId: orderId });
      }

      return PosRepository.addItem(orderId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
    },
  });
}

// Online-only mutations (no outbox — these are server-authoritative).

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
    mutationFn: (payload: ApplyDiscountPayload) =>
      PosRepository.applyDiscount(orderId, payload),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOfflineOrderStub(
  clientOrderId: string,
  branchId: string,
  payload: Pick<CreateOrderPayload, "branchId" | "clientOrderId"> & Partial<CreateOrderPayload>,
): Order {
  return {
    id: clientOrderId,
    branchId: payload.branchId || branchId,
    orderNo: null,
    type: payload.type ?? "DINE_IN",
    status: "DRAFT",
    derivedStatus: "DRAFT",
    tableId: payload.tableId ?? null,
    coverCount: payload.coverCount ?? 1,
    cashierId: null,
    customerId: payload.customerId ?? null,
    subtotalPaisa: 0,
    taxPaisa: 0,
    discountPaisa: 0,
    serviceChargePaisa: 0,
    totalPaisa: 0,
    notes: payload.notes ?? null,
    openedAt: null,
    sentToKdsAt: null,
    clientOrderId,
    version: 0,
    items: [],
  };
}
