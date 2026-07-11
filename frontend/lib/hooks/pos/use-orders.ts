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
    // TanStack Query's default networkMode ("online") PAUSES the mutation — never
    // even calling mutationFn — while its own onlineManager sees the browser offline,
    // which silently defeats the `if (!isOnline)` enqueue-immediately branch below
    // (confirmed via 07.1-06 E2E: outbox stayed empty and sync-badge never appeared
    // until reconnect). "always" makes mutationFn run immediately regardless, so this
    // hook's OWN isOnline branching (backed by the app's browser-event-driven
    // useOnlineStatus, not React Query's manager) is what actually decides the path.
    networkMode: "always",
    mutationFn: async (payload: CreateOrderPayload): Promise<Order> => {
      const clientOrderId = payload.clientOrderId ?? crypto.randomUUID();

      if (!isOnline) {
        await enqueue({
          type: "CREATE_ORDER",
          clientOrderId,
          payload: { ...payload, clientOrderId },
        });
        // Return a local-only DRAFT stub so the UI renders immediately, and seed it
        // directly into the useOrder cache — otherwise OrderPanel keeps showing "No
        // active order" while offline (POS-14 UAT gap) because there is no server
        // response to populate that query.
        const stub = buildOfflineOrderStub(clientOrderId, branchId, payload);
        queryClient.setQueryData(queryKeys.pos.order(branchId, clientOrderId), stub);
        return stub;
      }

      return PosRepository.createOrder({ ...payload, clientOrderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      // See the order-summaries invalidation note on useSendToKds below — the Order
      // Management list (POS-09) reads a DIFFERENT query key than the legacy "orders"
      // key this mutation already invalidated.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
    },
  });
}

/**
 * `orderId` is a MUTATE-TIME variable, not a hook-argument — deliberately, so a single
 * mutation instance never binds to a stale order id. (07.1-08 investigation: the
 * previous `useAddItem(orderId)` shape closed its `mutationFn` over whatever
 * `activeOrderId` the CALLING component's render captured; any invocation racing an
 * in-flight order-creation — not just literally the first tap — saw a stale/empty id.
 * pos-terminal.tsx now always resolves the real order id itself before calling
 * `mutateAsync({ orderId, payload })`, so this hook is correct regardless of timing.)
 */
export function useAddItem() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();

  return useMutation({
    // See the networkMode comment on useCreateOrder above — same fix, same reason.
    networkMode: "always",
    mutationFn: async ({
      orderId,
      payload,
    }: {
      orderId: string;
      payload: AddItemPayload;
    }): Promise<Order> => {
      if (!isOnline) {
        // clientOrderId for APPEND_ITEMS is the server orderId (or local id when
        // the order was also created offline in this session).
        await enqueue({ type: "APPEND_ITEMS", clientOrderId: orderId, payload });
        // Return a minimal stub so the mutation resolves without an error.
        return buildOfflineOrderStub(orderId, branchId, { branchId, clientOrderId: orderId });
      }

      return PosRepository.addItem(orderId, payload);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, variables.orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
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
      // `queryKeys.pos.orderSummaries` lives under a DIFFERENT key segment
      // ("order-summaries", not "orders") than the legacy list above — this mutation
      // (and every other order-mutating one in this file/use-payments.ts) previously
      // only invalidated "orders", which useOrderSummaries (POS-09 Order Management,
      // 07.1-09) never reads. Without this, the new Order Management screen would show
      // stale derivedStatus/total/item data after any send-to-kds/close/void/refund/
      // mark-served/cancel/add-item action taken elsewhere (e.g. from this same
      // drawer's own settlement footer) — a correctness bug for this plan's own
      // "non-closed order never disappears / closes fade out" requirement. Prefix-match
      // invalidates every statuses-filter variant of the query key.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
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
    // See the networkMode comment on useCreateOrder above — same fix, same reason.
    networkMode: "always",
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
      // See the order-summaries invalidation note on useSendToKds above — marking a
      // line SERVED can flip the order's derivedStatus (e.g. IN_PROGRESS ->
      // PARTIALLY_SERVED/SERVED), which the Order Management list's status column/
      // filter chips must reflect.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
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
      // See the order-summaries invalidation note on useSendToKds above.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
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
