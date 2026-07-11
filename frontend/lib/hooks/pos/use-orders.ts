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
  UpdateInstructionsPayload,
} from "@/lib/models/pos.model";

// ── Queries ───────────────────────────────────────────────────────────────────

/** Order Management list (POS-09). GET /pos/orders now returns OrderSummaryDto[]. */
export function useOrderSummaries(statuses?: string[]) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.orderSummaries(branchId, statuses),
    queryFn: () => PosRepository.listOrderSummaries({ branchId, status: statuses }),
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

/**
 * Fires the order's currently-PENDING lines as an incrementing revision (POS-12). A fresh
 * `clientFireId` (crypto.randomUUID()) is generated per invocation and sent as the
 * Idempotency-Key header — the revision-aware CTA label/enable-state logic itself stays
 * in the component (order-panel.tsx, a later plan); this hook only exposes
 * mutateAsync/isPending.
 */
export function useSendToKds(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: () => PosRepository.sendToKds(orderId, crypto.randomUUID()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}

/**
 * Order-level + per-item instructions edit (POS-13). Offline-safe: enqueues an
 * UPDATE_INSTRUCTIONS outbox op when offline (mirrors useAddItem's offline branching),
 * replayed FIFO by the sync-engine once back online.
 */
export function useUpdateInstructions(orderId: string) {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();

  return useMutation({
    mutationFn: async (payload: UpdateInstructionsPayload): Promise<Order | undefined> => {
      if (!isOnline) {
        await enqueue({ type: "UPDATE_INSTRUCTIONS", clientOrderId: orderId, payload });
        return undefined;
      }
      return PosRepository.updateInstructions(orderId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
    },
  });
}

/**
 * Marks a single line SERVED (cashier/server-side action, never from the KDS — the
 * kitchen has no visibility once food leaves the pass). Server-authoritative, not
 * offline-critical per UI-SPEC — no outbox path.
 */
export function useMarkServed(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (itemId: string) => PosRepository.markItemServed(orderId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}

/**
 * Cancels a single line (Status System "CANCELLED" — cashier-initiated, works even
 * after the line was SENT+; kept visible with the cancelled treatment rather than
 * removed). Server-authoritative, not offline-critical — mirrors useMarkServed's shape.
 */
export function useCancelItem(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (itemId: string) => PosRepository.cancelItem(orderId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
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
