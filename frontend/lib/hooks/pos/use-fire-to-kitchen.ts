"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { enqueue } from "@/lib/offline/outbox";
import type { SendToKdsOpPayload } from "@/lib/offline/types";
import type { Order } from "@/lib/models/pos.model";

/**
 * Mutate-time-orderId sibling of use-orders.ts's `useSendToKds`, which binds `orderId`
 * at HOOK-CREATION time — correct for order-panel.tsx's per-render "re-fire a
 * revision on an already-persisted order" use, but unusable for pos-terminal.tsx's
 * lazy-persist first Send/Charge: the server-assigned orderId is only known INSIDE
 * the same click handler that must also fire it, so a hook bound to the previous
 * render's null/"" id would fire against the wrong (or no) target — the exact
 * "stale-closure across an id known only at call time" class of bug already fixed for
 * `useAddItem` (07.1-08 SUMMARY). Kept in a new file rather than editing
 * use-orders.ts, which 07.3-06 owns this phase (07.3-03 plan `<context>`).
 *
 * <h2>Offline (S0-07)</h2>
 * This hook used to be the ONLY step of Send to Kitchen with no outbox path. Offline,
 * `createOrder` and every `addItem` queued themselves and resolved, then this mutation —
 * on React Query's default `networkMode: "online"` — was PAUSED: `mutateAsync` neither
 * resolved nor rejected, the caller's `await` hung forever, and the fire the cashier
 * pressed was never recorded anywhere. The order replayed on reconnect as a DRAFT the
 * kitchen never saw. Now it enqueues a SEND_TO_KDS op, exactly like its siblings, and
 * `networkMode: "always"` keeps this hook's OWN `isOnline` branch in charge of the
 * decision (see the same note on `useCreateOrder`).
 *
 * Resolves to the fired {@link Order} when it reached the server, or `null` when it was
 * QUEUED — callers must branch on that rather than announcing "Sent to kitchen".
 */
export function useFireToKitchen() {
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();

  return useMutation({
    networkMode: "always",
    mutationFn: async ({ orderId }: { orderId: string }): Promise<Order | null> => {
      if (!isOnline) {
        const payload: SendToKdsOpPayload = { clientFireId: crypto.randomUUID() };
        await enqueue({ type: "SEND_TO_KDS", clientOrderId: orderId, payload });
        return null;
      }
      return PosRepository.sendToKds(orderId, crypto.randomUUID());
    },
    onSuccess: (fired, variables) => {
      // Nothing to re-read while offline: every one of these refetches would fail, and
      // the queued truth the panel renders comes from the outbox, not from the server.
      if (!fired) return;
      queryClient.setQueryData(queryKeys.pos.order(branchId, variables.orderId), fired);
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, variables.orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}
