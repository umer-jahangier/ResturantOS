"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import { wsUrl } from "@/lib/hooks/ws-base-url";
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
 * The one frame on this socket that is not an OrderDto — pos-service's
 * {@link MenuChangedFrame}, sent tenant-wide after a menu write commits.
 */
interface MenuChangedFrame {
  event: "menu.changed";
  change: string;
  itemId: string | null;
  itemName: string | null;
  active: boolean | null;
}

function isMenuChangedFrame(raw: unknown): raw is MenuChangedFrame {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { event?: unknown }).event === "menu.changed"
  );
}

/** Only a deactivation/deletion that names the item earns a toast — a price edit does not. */
function frameSaysUnavailable(
  frame: MenuChangedFrame,
): frame is MenuChangedFrame & { itemName: string } {
  return (
    typeof frame.itemName === "string" &&
    frame.itemName.length > 0 &&
    (frame.change === "item.deactivated" || frame.change === "item.deleted")
  );
}

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
export function usePosOrdersSocket({
  branchId,
}: UsePosOrdersSocketOptions): UsePosOrdersSocketResult {
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

      const url = wsUrl(`/api/v1/pos/ws/orders/${branchId}?token=${accessToken}`);

      ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        backoff = INITIAL_BACKOFF_MS;
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string) as unknown;

          // ── menu.changed ────────────────────────────────────────────────────────────
          // The 86 path (register S1 #13). pos-service pushes this to every terminal of the
          // tenant once a menu write COMMITS. Discriminated on `event`, which an OrderDto
          // never has — note it deliberately is NOT `type`, because an OrderDto *does* carry
          // a `type` (DINE_IN/TAKEAWAY) and a future OrderType could collide with a string
          // chosen here.
          //
          // The response is an invalidation, not a patch: what a till may sell is item.active
          // AND category.active AND the branch override AND the caller's permissions, and
          // GET /menu/items is the only thing that computes all four. Re-reading it is the
          // whole point; hand-patching the cache from the frame would reintroduce the class of
          // bug this repo is full of — a screen that agrees with a message instead of with the
          // server. The prefix ["pos", branchId, "menu-items"] also covers the admin key
          // (…, "admin", categoryId) and every per-category variant, so a manager's own Menu
          // Items list refreshes from another manager's edit too.
          if (isMenuChangedFrame(raw)) {
            queryClient.invalidateQueries({ queryKey: ["pos", branchId, "menu-items"] });
            queryClient.invalidateQueries({ queryKey: ["pos", branchId, "menu-categories"] });
            // A tile that silently vanishes under a cashier's finger is its own hazard — they
            // are mid-tap on a 100px grid that just reflowed. Say what left, once, and only
            // for the case that costs money: an item going unavailable.
            if (frameSaysUnavailable(raw)) {
              toast.warning(`${raw.itemName} is no longer available`, {
                description: "It was removed from the menu — the tile is gone from your grid.",
              });
            }
            return;
          }

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
