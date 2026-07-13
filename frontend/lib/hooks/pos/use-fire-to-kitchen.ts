"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
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
 */
export function useFireToKitchen() {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();

  return useMutation({
    mutationFn: ({ orderId }: { orderId: string }): Promise<Order> =>
      PosRepository.sendToKds(orderId, crypto.randomUUID()),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, variables.orderId) });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
    },
  });
}
