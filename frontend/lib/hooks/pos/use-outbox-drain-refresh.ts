"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { onProgress } from "@/lib/offline/sync-engine";

/**
 * Re-read every POS query once the outbox finishes draining.
 *
 * A replay pass rewrites server state that this tab has cached snapshots of, and it does
 * it OUTSIDE the mutation hooks, so none of their `invalidateQueries` calls run. The
 * visible consequence (measured 2026-08-12, S0-07 reconnect probe): a terminal that
 * queued an order offline followed it to the server's id, fetched it in the instant
 * between the CREATE_ORDER and the APPEND_ITEMS ops replaying, and then sat on that
 * empty snapshot — "New Order / Draft / Rs 0.00" for an order that was by then
 * ORD-…-0053, SENT_TO_KDS, Rs 499.00.
 *
 * Subscribing to sync progress rather than to the `online` event covers every path that
 * drains the outbox — reconnect, mount, and the sync badge's explicit "Retry now" —
 * because they all emit progress. Mount it ONCE, at the POS layout.
 */
export function useOutboxDrainRefresh(): void {
  const queryClient = useQueryClient();
  const { branchId } = useCurrentUser();
  const prevPendingRef = useRef(0);

  useEffect(() => {
    return onProgress((pending) => {
      const justDrained = prevPendingRef.current > 0 && pending === 0;
      prevPendingRef.current = pending;
      if (!justDrained) return;
      // Prefix-match the whole branch: the replay may have created an order, added its
      // lines, fired it and flipped a table's occupancy, and the summaries list, the
      // order detail and the floor view all read different keys under this prefix.
      queryClient.invalidateQueries({ queryKey: ["pos", branchId] });
    });
  }, [queryClient, branchId]);
}
