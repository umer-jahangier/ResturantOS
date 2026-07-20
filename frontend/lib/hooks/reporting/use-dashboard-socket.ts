"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import { wsUrl } from "@/lib/hooks/ws-base-url";
import { apiDashboardTileSchema } from "@/lib/api-client/schemas/reporting.schema";
import { adaptDashboardTile } from "@/lib/adapters/reporting.adapter";
import type { DashboardTile } from "@/lib/models/reporting.model";

interface UseDashboardSocketOptions {
  branchId: string;
}

interface UseDashboardSocketResult {
  isConnected: boolean;
  tiles: DashboardTile[] | undefined;
}

// Cloned from frontend/lib/hooks/kds/use-kds-socket.ts (the proven JWT-in-query-param +
// exponential-backoff reconnect pattern) per 12-06-SUMMARY.md's pinned contract. The KDS beep
// (playNewTicketBeep) is deliberately dropped — a dashboard that beeps on every order during a
// dinner rush is a hostile UI.
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Maintains a WebSocket connection to the reporting-service realtime dashboard endpoint
 * (`/api/v1/reporting/dashboard/{branchId}`). On each frame (a JSON array of DashboardTileDto),
 * the tiles are Zod-parsed and written into the SAME TanStack Query cache key the REST snapshot
 * (`useDashboardTiles`) uses — the WS push and the REST snapshot are ONE source of truth, never
 * two competing states. Auto-reconnects with exponential backoff.
 *
 * All WebSocket state is managed inside the effect via local closure variables. This avoids both
 * the self-referential useCallback lint issue and the "cannot set state during effect" rule
 * (react-hooks/set-state-in-effect — 04-04-A).
 */
export function useDashboardSocket({ branchId }: UseDashboardSocketOptions): UseDashboardSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const [tiles, setTiles] = useState<DashboardTile[] | undefined>(undefined);
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

      const url = wsUrl(`/api/v1/reporting/dashboard/${branchId}?token=${accessToken}`);

      ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        backoff = INITIAL_BACKOFF_MS;
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string) as unknown;
          const rawTiles = Array.isArray(raw) ? raw : [];
          const parsed: DashboardTile[] = rawTiles.map((t) =>
            adaptDashboardTile(apiDashboardTileSchema.parse(t)),
          );
          // The WS push and the REST snapshot (useDashboardTiles) share ONE cache key — writing
          // here keeps every consumer of that key live, not just this hook's own return value.
          queryClient.setQueryData<DashboardTile[]>(queryKeys.reporting.dashboardTiles(branchId), parsed);
          setTiles(parsed);
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
        // Plain local function reference — no circular hook dependency.
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

  return { isConnected, tiles };
}
