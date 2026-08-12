"use client";

import { useEffect, useState } from "react";
import { queuedForOrder, type QueuedForOrder } from "@/lib/offline/outbox";
import { onProgress } from "@/lib/offline/sync-engine";

const NOTHING_QUEUED: QueuedForOrder = { queued: 0, fireQueued: false, dead: 0 };

/**
 * What this order still owes the server, straight out of the IndexedDB outbox.
 *
 * The order panel needs to be able to say "the kitchen has NOT seen this yet" without
 * the domain inventing a status for it. `Order.status` is the SERVER's word and offline
 * there is no server, so an optimistic stub saying DRAFT (or, worse, saying nothing) is
 * how S0-07 let a cashier believe food had been sent. The outbox is the only component
 * that actually knows, so the UI asks it.
 *
 * Re-reads on every sync-engine progress emission — which `enqueue()` itself fires, so
 * the strip appears the instant an op is queued and disappears the instant it drains.
 */
export function useQueuedOps(orderId: string | null | undefined): QueuedForOrder {
  // Keyed by the order it was read FOR, so a switch to another order (or to none) can be
  // answered from the render body rather than by a setState in the effect — which the
  // repo's `react-hooks/set-state-in-effect` rule forbids, and which would flash the
  // previous order's queue depth for one frame anyway.
  const [state, setState] = useState<{ orderId: string; value: QueuedForOrder } | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    const refresh = () => {
      queuedForOrder(orderId)
        .then((value) => {
          if (alive) setState({ orderId, value });
        })
        // No IndexedDB (private browsing, a locked-down device, jsdom) means no outbox
        // and therefore nothing queued. Never let a storage failure reject into the
        // render tree — the strip simply does not appear.
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = onProgress(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [orderId]);

  return state && state.orderId === orderId ? state.value : NOTHING_QUEUED;
}
