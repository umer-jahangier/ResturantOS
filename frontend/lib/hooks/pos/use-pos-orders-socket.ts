"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import { apiOrderSchema } from "@/lib/api-client/schemas/pos.schema";
import { adaptOrder } from "@/lib/adapters/pos.adapter";
import type { Order } from "@/lib/models/pos.model";

interface UsePosOrdersSocketOptions {
  branchId: string;
}

interface UsePosOrdersSocketResult {
  isConnected: boolean;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Maintains a WebSocket to the pos-service branch order stream
 * (`/api/v1/pos/ws/orders/{branchId}?token=…`) — the POS-side twin of
 * {@link import("@/lib/hooks/kds/use-kds-socket").useKdsSocket}. Kitchen→pos consumers push
 * the full updated OrderDto whenever an order in this branch changes (per-item kitchen status,
 * order-ready). On each frame the order is merged into the TanStack cache so every POS surface
 * (Order Management list, the Order/Table detail drawer via `useOrder`) reflects kitchen
 * progress LIVE — the 15s `useOrder` poll is now only a relaxed fallback for a dropped socket.
 *
 * All socket state lives inside the effect via closure locals (same structure as
 * use-kds-socket) to avoid self-referential useCallback / ref-during-render pitfalls.
 */
export function usePosOrdersSocket({ branchId }: UsePosOrdersSocketOptions): UsePosOrdersSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((s) => s.session?.accessToken);

  useEffect(() => {
    if (!accessToken || !branchId) return;

    let destroyed = false;
    let backoff = INITIAL_BACKOFF_MS;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function openSocket() {
      if (destroyed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = process.env.NEXT_PUBLIC_POS_WS_URL ?? window.location.host;
      const url = `${protocol}//${host}/api/v1/pos/ws/orders/${branchId}?token=${accessToken}`;

      ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        backoff = INITIAL_BACKOFF_MS;
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string) as unknown;
          const order: Order = adaptOrder(apiOrderSchema.parse(raw));
          // Seed the order-detail cache so an open drawer / terminal updates live…
          queryClient.setQueryData<Order>(queryKeys.pos.order(branchId, order.id), order);
          // …and refresh the Order Management summaries list (different, richer DTO than the
          // pushed OrderDto — settlement/payment/quantity fields — so invalidate rather than
          // attempt a lossy in-place merge). Prefix-match covers every statuses-filter variant.
          queryClient.invalidateQueries({ queryKey: ["pos", branchId, "order-summaries"] });
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onclose = () => {
        ws = null;
        setIsConnected(false);
        if (destroyed) return;
        const delay = Math.min(backoff, MAX_BACKOFF_MS);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(openSocket, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    openSocket();

    return () => {
      destroyed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [branchId, accessToken, queryClient]);

  return { isConnected };
}
