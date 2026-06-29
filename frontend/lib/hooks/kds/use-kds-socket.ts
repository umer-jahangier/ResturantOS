"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import { apiKdsTicketSchema } from "@/lib/api-client/schemas/kds.schema";
import { adaptKdsTicket } from "@/lib/adapters/kds.adapter";
import type { KdsTicket } from "@/lib/models/kds.model";

interface UseKdsSocketOptions {
  branchId: string;
  stationCode: string;
}

interface UseKdsSocketResult {
  isConnected: boolean;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Maintains a WebSocket connection to the kitchen-service KDS board endpoint.
 * On each message, the ticket update is merged into the TanStack Query cache.
 * Auto-reconnects with exponential backoff.
 *
 * All WebSocket state is managed inside the effect via local closure variables.
 * This avoids both the self-referential useCallback lint issue and the
 * "cannot access/update ref during render" rule.
 */
export function useKdsSocket({ branchId, stationCode }: UseKdsSocketOptions): UseKdsSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((s) => s.session?.accessToken);

  useEffect(() => {
    if (!accessToken || !branchId || !stationCode) return;

    let destroyed = false;
    let backoff = INITIAL_BACKOFF_MS;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function openSocket() {
      if (destroyed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = process.env.NEXT_PUBLIC_KITCHEN_WS_URL ?? window.location.host;
      const url = `${protocol}//${host}/api/v1/kitchen/kds/${branchId}/${stationCode}?token=${accessToken}`;

      ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        backoff = INITIAL_BACKOFF_MS;
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string) as unknown;
          const ticket: KdsTicket = adaptKdsTicket(apiKdsTicketSchema.parse(raw));
          queryClient.setQueryData<KdsTicket[]>(
            queryKeys.kds.tickets(branchId, stationCode),
            (prev = []) => {
              const idx = prev.findIndex((t) => t.id === ticket.id);
              if (idx === -1) return [...prev, ticket];
              const next = [...prev];
              next[idx] = ticket;
              return next;
            },
          );
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
  }, [branchId, stationCode, accessToken, queryClient]);

  return { isConnected };
}
