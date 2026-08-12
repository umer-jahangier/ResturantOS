"use client";

import { useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { enqueue } from "@/lib/offline/outbox";
import { resolveSyncedOrderId, subscribeResolvedOrderIds } from "@/lib/offline/sync-engine";
import type { SendToKdsOpPayload } from "@/lib/offline/types";
import type {
  MenuItem,
  Order,
  OrderItem,
  AddItemPayload,
  ApplyDiscountPayload,
  CreateOrderPayload,
  UpdateInstructionsPayload,
} from "@/lib/models/pos.model";

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Order Management list (POS-09). GET /pos/orders now returns OrderSummaryDto[].
 *
 * `options.enabled` (POS-24, 07.3-08): lets a caller mount a SECOND instance of this
 * hook for an explicit terminal-`statuses` request (e.g. the Order Management Closed
 * filter) without it fetching until that filter is actually selected — additive,
 * defaults to `true` so every existing call site is unaffected.
 *
 * `options.q` (S0-05): a SERVER-side search term. The search box used to filter the rows
 * this hook had already returned, which meant it could only ever find an order that was both
 * on the current page and inside the current status chip — a voided check was invisible to a
 * search for its own number. With `q` set the server matches order number, table name and the
 * attached customer's phone/name across every status, so the search reaches rows the page
 * never fetched. `options.size` widens the page for those results.
 */
export function useOrderSummaries(
  statuses?: string[],
  options?: { enabled?: boolean; q?: string; size?: number },
) {
  const { branchId, isAuthenticated } = useCurrentUser();
  const q = options?.q?.trim() || undefined;
  return useQuery({
    queryKey: queryKeys.pos.orderSummaries(branchId, statuses, q),
    queryFn: () =>
      PosRepository.listOrderSummaries({
        branchId,
        status: statuses,
        ...(q ? { q } : {}),
        ...(options?.size ? { size: options.size } : {}),
      }),
    enabled: isAuthenticated && !!branchId && (options?.enabled ?? true),
    // Order Management is an operational list that must show accurate data the moment
    // it opens. The global default (staleTime 30s, refetchOnMount honours staleness)
    // meant reopening the tab within 30s of the last fetch served the cached snapshot,
    // forcing a manual refresh (POS-09). Override locally: always refetch on mount and
    // on window focus, and treat the data as immediately stale. Scoped to this hook —
    // the global defaults still apply everywhere else.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * `refetchInterval` (POS-20): the order detail surfaces (Order Management drawer, Table
 * Floor View) previously only refetched on open, so a kitchen-side per-item status
 * transition (KITCHEN_ITEM_STATUS_CHANGED, fixed backend-side in 07.3-02) never showed
 * up until the user manually closed/reopened the surface.
 *
 * The primary live path is now the branch order WebSocket (`usePosOrdersSocket`, mounted
 * once at the POS page level), which pushes the full updated OrderDto into this exact
 * query key the instant a kitchen→pos consumer applies a change. This poll is kept only as
 * a RELAXED FALLBACK for a dropped/absent socket (mirrors the KDS board keeping its ~10s
 * poll alongside its socket) — hence widened from 5s to 15s now that it is no longer the
 * mechanism carrying live kitchen progress.
 */
const ORDER_REFETCH_INTERVAL_MS = 15000;

export function useOrder(orderId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  /**
   * Follow an offline-created order to the id the server gave it (S0-07).
   *
   * A terminal that rang an order while the line was down holds a LOCAL stub id. Once the
   * outbox replays, the server issues its own id and the stub resolves to nothing — the
   * panel used to keep rendering a "New Order / Draft" ghost with no order number and a
   * live Send to Kitchen button, while the real ORD-…-0053 existed in Order Management.
   * `useSyncExternalStore` re-reads on every remap and bails out when the string is
   * unchanged, so the far more common case (an id that was always real) costs nothing.
   */
  const resolvedId = useSyncExternalStore(
    subscribeResolvedOrderIds,
    () => resolveSyncedOrderId(orderId),
    () => orderId,
  );
  return useQuery({
    queryKey: queryKeys.pos.order(branchId, resolvedId),
    queryFn: () => PosRepository.getOrder(resolvedId, branchId),
    enabled: isAuthenticated && !!branchId && !!resolvedId,
    refetchInterval: ORDER_REFETCH_INTERVAL_MS,
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
        // S0-07: this used to return a FRESH zero-money stub, which onSuccess then wrote
        // over the cache — so the panel showed "Subtotal Rs 0.00 / Total Rs 0.00" for a
        // real Rs 499 order. Accumulate onto whatever the cache already holds instead,
        // pricing the line from the cached menu the cashier just tapped.
        const key = queryKeys.pos.order(branchId, orderId);
        const base =
          queryClient.getQueryData<Order>(key) ??
          buildOfflineOrderStub(orderId, branchId, { branchId, clientOrderId: orderId });
        return appendOfflineItem(base, payload, findCachedMenuItem(queryClient, branchId, payload));
      }

      return PosRepository.addItem(orderId, payload);
    },
    onSuccess: (_data, variables) => {
      // Seed the cache with the mutation response FIRST (RESEARCH POS-21 instant-UI
      // seam) so the added line renders immediately, before the invalidation-driven
      // refetch below lands. Offline stub responses go through this same path too —
      // that's fine, it's the same shape returned by buildOfflineOrderStub above and
      // gets superseded once the outbox replay's real response invalidates again.
      queryClient.setQueryData(queryKeys.pos.order(branchId, variables.orderId), _data);
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
    mutationFn: (payload: ApplyDiscountPayload) => PosRepository.applyDiscount(orderId, payload),
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
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    // See the networkMode note on useCreateOrder — without it React Query PAUSES the
    // mutation while offline and the caller's await never settles, which is how the
    // offline fire went missing in the first place (S0-07).
    networkMode: "always",
    /** Resolves to the fired order, or `null` when the fire was QUEUED for reconnect. */
    mutationFn: async (): Promise<Order | null> => {
      if (!isOnline) {
        const payload: SendToKdsOpPayload = { clientFireId: crypto.randomUUID() };
        await enqueue({ type: "SEND_TO_KDS", clientOrderId: orderId, payload });
        return null;
      }
      return PosRepository.sendToKds(orderId, crypto.randomUUID());
    },
    onSuccess: (fired) => {
      // Offline there is nothing to re-read; the panel's "Queued" strip reads the outbox.
      if (!fired) return;
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
 * Assign-table row action (POS-24, `PATCH /orders/{id}/table`). Mirrors `useSendToKds`'s
 * multi-key invalidation shape (order-specific hook, `orderId` bound at hook-creation
 * time like `useMarkServed`/`useCancelItem`) so the Order Management row + the assigned
 * table's status update immediately across the UI without a manual refresh.
 */
export function useAssignTable(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: (tableId: string) => PosRepository.assignTable(orderId, tableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      // See the order-summaries invalidation note on useSendToKds above.
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
 * S0-06 — "Mark served & close order", the settlement screen's terminal step.
 *
 * <p>Deliberately NOT offline-capable and deliberately not optimistic: closing an order is the
 * event finance posts revenue from, and the server decides whether it happens (it closes only
 * when the check is also fully paid). The screen must show the server's answer, not a hopeful
 * one. Invalidates the same keys as `useMarkServed` plus the order LIST, because a close moves
 * the row out of every active filter and into Closed.
 */
export function useServeAllItems(orderId: string) {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation({
    mutationFn: () => PosRepository.serveAllItems(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, orderId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
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

/**
 * The menu row backing an offline line, read out of the SAME TanStack cache the menu grid
 * rendered from. The cashier could only have tapped a tile that is in that cache, so this
 * is the price they were looking at when they tapped — not a second source of truth.
 */
function findCachedMenuItem(
  queryClient: QueryClient,
  branchId: string,
  payload: AddItemPayload,
): MenuItem | undefined {
  // Prefix match: the key is ["pos", branchId, "menu-items", categoryId?], and the grid
  // may hold one entry per category filter.
  const entries = queryClient.getQueriesData({ queryKey: ["pos", branchId, "menu-items"] });
  for (const [, data] of entries) {
    if (!Array.isArray(data)) continue;
    const hit = (data as MenuItem[]).find((item) => item?.id === payload.menuItemId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Append one queued line to an offline order and re-total it.
 *
 * Mirrors pos-service's `OrderPricingCalculator` exactly, because the number on this
 * screen is the number the guest is told:
 *   lineSubtotal = unitPrice * qty · lineTax = HALF_UP(lineSubtotal * pct/100)
 *   lineTotal    = lineSubtotal + lineTax          (tax-INCLUSIVE, per `lineTotal()`)
 *   order.subtotal = Σ lineSubtotal · order.total = subtotal + tax
 * All integer paisa — `Math.round` on a positive value IS HALF_UP, and it is the same
 * expression `cartTaxPaisa` already uses for the pre-send estimate, so the cart total and
 * the queued-order total agree to the paisa.
 *
 * The server recomputes authoritatively when the outbox replays; until then this is the
 * cashier's honest best estimate rather than a zero.
 */
function appendOfflineItem(
  order: Order,
  payload: AddItemPayload,
  menuItem: MenuItem | undefined,
): Order {
  const unitPricePaisa = menuItem?.basePricePaisa ?? 0;
  const lineSubtotal = unitPricePaisa * payload.quantity;
  const lineTax = Math.round((lineSubtotal * (menuItem?.taxRatePct ?? 0)) / 100);

  const item: OrderItem = {
    id: `offline:${crypto.randomUUID()}`,
    menuItemId: payload.menuItemId,
    itemNameSnapshot: menuItem?.name ?? "Queued item",
    unitPriceSnapshot: unitPricePaisa,
    quantity: payload.quantity,
    kdsStation: menuItem?.kdsStation ?? null,
    itemStatus: "PENDING",
    revisionNo: 0,
    firedAt: null,
    discountPaisa: 0,
    taxPaisa: lineTax,
    lineTotalPaisa: lineSubtotal + lineTax,
    notes: payload.notes ?? null,
    modifiers: [],
  };

  const items = [...order.items, item];
  const subtotalPaisa = order.subtotalPaisa + lineSubtotal;
  const taxPaisa = order.taxPaisa + lineTax;
  return {
    ...order,
    items,
    subtotalPaisa,
    taxPaisa,
    totalPaisa: subtotalPaisa - order.discountPaisa + taxPaisa + order.serviceChargePaisa,
  };
}

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
