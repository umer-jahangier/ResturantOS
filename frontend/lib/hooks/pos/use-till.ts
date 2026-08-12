"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import type { OpenTillPayload, CloseTillPayload, TillSession } from "@/lib/models/pos.model";
import type {
  EligibleCashier,
  OpenTillForCashierPayload,
} from "@/lib/models/till-cashier.model";
import type { ApiError } from "@/lib/api-client/errors";

const OFFLINE_ERROR =
  "This action requires a connection. Period lock, approvals and payments are processed online.";

export function useTillSession(tillId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pos.till(tillId ?? ""),
    queryFn: () => PosRepository.getTill(tillId!),
    enabled: !!tillId,
  });
}

/**
 * The current cashier's OPEN till session, if any (POS-14: page-level TillSessionBar
 * per UI-SPEC §3 — till state is session-scoped, not order/tab-scoped). A cashier has at
 * most one OPEN till, so this takes the single result.
 *
 * Deliberately sends NO cashierId: the endpoint resolves an omitted cashierId to the
 * caller's own JWT subject, and refuses a foreign one. Passing our own id would be
 * redundant (the server ignores the client's opinion of who it is) and would keep alive
 * the client-controlled identity parameter that allowed cross-cashier till reads.
 * The userId still scopes the CACHE KEY so one browser profile can't serve another's till.
 */
export function useActiveTill() {
  const { userId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.activeTill(userId),
    queryFn: async () => {
      const tills = await PosRepository.listTills({ status: "OPEN" });
      return tills[0] ?? null;
    },
    enabled: isAuthenticated && !!userId,
  });
}

/**
 * A till session's reconciliation (orders within it + live expected cash). Polled so the
 * active-till bar shows accumulating cash as orders are charged (fixes "charged but till shows
 * 0"). Also backs the admin till-review drill-down.
 */
export function useTillReconciliation(tillId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pos.tillReconciliation(tillId ?? ""),
    queryFn: () => PosRepository.getTillReconciliation(tillId!),
    enabled: !!tillId,
    refetchInterval: 10_000,
  });
}

/**
 * Branch-wide till history for the manager till-review table (newest first), server-paginated.
 * `keepPreviousData` so paging doesn't drop the table back to a loading skeleton.
 */
export function useBranchTills(branchId: string | null | undefined, page = 0, size = 20) {
  return useQuery({
    queryKey: queryKeys.pos.branchTills(branchId ?? "", page, size),
    queryFn: () => PosRepository.listBranchTills({ branchId: branchId!, page, size }),
    enabled: !!branchId,
    placeholderData: keepPreviousData,
  });
}

/** Append-only manager review history for one till session. */
export function useTillReviewActions(tillId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pos.tillReviewActions(tillId ?? ""),
    queryFn: () => PosRepository.listTillReviewActions(tillId!),
    enabled: !!tillId,
  });
}

// Typed with the live `ApiError` (Layer-1 type import is allowed here — Layer-3
// hooks — but NOT in components/**, FE-08 boundary) so TillSessionBar can branch on
// `.status`/`.message` the same way PaymentPanel/VoidRefundDialog already do for
// their own mutations (mirrors use-payments.ts's useCloseOrder/useVoidOrder pattern).
export function useOpenTill() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  return useMutation<TillSession, ApiError, OpenTillPayload>({
    // Default networkMode ("online") PAUSES mutationFn entirely while React Query's
    // own onlineManager sees the browser offline — the `if (!isOnline) throw` below
    // would then never run until reconnect, so the OFFLINE_ERROR message could never
    // show promptly (same class of bug fixed in use-orders.ts's offline mutations;
    // confirmed via 07.1-06 E2E network/IndexedDB tracing). "always" lets this hook's
    // own isOnline check (browser-event-driven, not React Query's manager) decide.
    networkMode: "always",
    mutationFn: (payload: OpenTillPayload) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.openTill(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}

export function useCloseTill() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  return useMutation<
    TillSession,
    ApiError,
    { tillId: string; payload: CloseTillPayload; idempotencyKey: string }
  >({
    // See the networkMode comment on useOpenTill above — same fix, same reason.
    networkMode: "always",
    mutationFn: ({
      tillId,
      payload,
      idempotencyKey,
    }: {
      tillId: string;
      payload: CloseTillPayload;
      idempotencyKey: string;
    }) => {
      if (!isOnline) throw new Error(OFFLINE_ERROR);
      return PosRepository.closeTill(tillId, payload, idempotencyKey);
    },
    onSuccess: (_data, { tillId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.till(tillId) });
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}

// ── Manager/owner till review ────────────────────────────────────────────────
// Back-office screen, so these deliberately keep React Query's DEFAULT networkMode —
// the "always" override above exists only for the cashier-facing offline POS terminal.

/** Invalidates every page of the branch list plus this session's review history. */
function useTillReviewInvalidation() {
  const queryClient = useQueryClient();
  return (tillId: string, branchId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.pos.branchTillsAll(branchId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.pos.tillReviewActions(tillId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.pos.till(tillId) });
  };
}

export function useApproveTill() {
  const invalidate = useTillReviewInvalidation();
  return useMutation<TillSession, ApiError, { tillId: string; branchId: string }>({
    mutationFn: ({ tillId }) => PosRepository.approveTill(tillId),
    onSuccess: (_data, { tillId, branchId }) => invalidate(tillId, branchId),
  });
}

export function useFlagTill() {
  const invalidate = useTillReviewInvalidation();
  return useMutation<TillSession, ApiError, { tillId: string; branchId: string; reason: string }>({
    mutationFn: ({ tillId, reason }) => PosRepository.flagTill(tillId, { reason }),
    onSuccess: (_data, { tillId, branchId }) => invalidate(tillId, branchId),
  });
}

export function useAddTillNote() {
  const invalidate = useTillReviewInvalidation();
  return useMutation<TillSession, ApiError, { tillId: string; branchId: string; note: string }>({
    mutationFn: ({ tillId, note }) => PosRepository.addTillNote(tillId, { note }),
    onSuccess: (_data, { tillId, branchId }) => invalidate(tillId, branchId),
  });
}

// ── Handing a drawer over (F11) ──────────────────────────────────────────────

/**
 * Keys for the "open a drawer for…" pair.
 *
 * <p>Declared here rather than in `query-keys.ts` — the same choice `use-order-bill.ts` makes for
 * `orderBillQueryKeys`. The list key is prefixed `["pos", "tills", …]` on purpose so the existing
 * `invalidateQueries({ queryKey: ["pos", "tills"] })` in `useOpenTill`/`useCloseTill` clears it
 * too: whether a cashier is holding a drawer is exactly what those mutations change.
 */
export const tillCashierQueryKeys = {
  eligible: (branchId: string) => ["pos", "tills", "eligible-cashiers", branchId] as const,
};

/**
 * Who at this branch may be handed a cash drawer, and who already holds one.
 *
 * <p>Gated server-side on `pos.till.open.other`, so a cashier calling this gets 403 — the caller
 * is expected to render it only for someone who holds that permission. `enabled` on `branchId`
 * because a query fired with an empty branch would ask pos-service about nothing and come back 422.
 */
export function useEligibleCashiers(branchId: string | null | undefined, enabled = true) {
  return useQuery<EligibleCashier[], ApiError>({
    queryKey: tillCashierQueryKeys.eligible(branchId ?? ""),
    queryFn: () => PosRepository.listEligibleCashiers(branchId!),
    enabled: enabled && Boolean(branchId),
  });
}

/**
 * The duty manager counting a float into a NAMED cashier's drawer.
 *
 * <p>Separate hook from `useOpenTill` (which opens the CALLER's own drawer) because they are two
 * different acts with different permissions and different failure modes — merging them would put
 * an `if (cashierId)` inside a mutation and make the error copy have to guess which one happened.
 *
 * <p>Keeps React Query's default `networkMode`, unlike `useOpenTill`: this is a back-office screen
 * on a manager's machine, not the offline-capable POS terminal.
 */
export function useOpenTillForCashier() {
  const queryClient = useQueryClient();
  return useMutation<TillSession, ApiError, OpenTillForCashierPayload>({
    mutationFn: (payload: OpenTillForCashierPayload) =>
      PosRepository.openTillForCashier(payload),
    onSuccess: (_data, payload) => {
      // The branch till table gains a row, and the picker's `hasOpenTill` flags change.
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.branchTillsAll(payload.branchId) });
      queryClient.invalidateQueries({ queryKey: ["pos", "tills"] });
    },
  });
}
