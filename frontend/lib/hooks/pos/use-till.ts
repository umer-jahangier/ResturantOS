"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import type { OpenTillPayload, CloseTillPayload, TillSession } from "@/lib/models/pos.model";
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
 * per UI-SPEC §3 — till state is session-scoped, not order/tab-scoped). Till sessions
 * are cashier-scoped, so this lists by `cashierId=currentUser, status=OPEN` and takes
 * the single result (a cashier can have at most one OPEN till at a time).
 */
export function useActiveTill() {
  const { userId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.activeTill(userId),
    queryFn: async () => {
      const tills = await PosRepository.listTills({ cashierId: userId, status: "OPEN" });
      return tills[0] ?? null;
    },
    enabled: isAuthenticated && !!userId,
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
