"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { adaptKdsTicket } from "@/lib/adapters/kds.adapter";
import { apiKdsTicketSchema } from "@/lib/api-client/schemas/kds.schema";
import { useSessionStore } from "@/lib/auth/session";
import { queryKeys } from "@/lib/hooks/query-keys";
import { wsUrl } from "@/lib/hooks/ws-base-url";
import type { KdsTicket } from "@/lib/models/kds.model";

interface UseKdsExpoSocketOptions {
  branchId: string;
  /** The branch's active station codes. One subscription is opened per code. */
  stationCodes: readonly string[];
}

export interface UseKdsExpoSocketResult {
  /** Live only when EVERY station's subscription is up — see the note below. */
  isConnected: boolean;
  connectedCount: number;
  stationCount: number;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * The pass, live.
 *
 * <h3>Why this is not `useKdsSocket`</h3>
 *
 * kitchen-service's WebSocket subscription key is `branchId:stationCode`
 * (`KdsWebSocketHandler`), and its path carries a station segment — there is no branch-wide
 * frame. That is right for a station board and wrong for a pass, whose entire job is to watch
 * every station at once. So the pass subscribes to each of them and merges the frames into
 * ONE cache entry: the branch-wide `queryKeys.kds.tickets(branchId)` list the pass reads.
 *
 * <h3>Why not just poll</h3>
 *
 * `useKdsTickets` already refetches every 10s, so a polled pass would technically update
 * "without a reload". A ten-second-old pass is a pass that tells the expeditor a plate is
 * still cooking for ten seconds after it went under the lamp, which is precisely the interval
 * that matters at a service pass. Both paths are kept: the sockets are the fast path and the
 * poll is the floor, exactly as the station board already does it.
 *
 * <h3>`isConnected` is deliberately strict</h3>
 *
 * It is true only when EVERY station's socket is open. A pass with four of five subscriptions
 * up is silently blind to one station's readiness — which is the same defect the pass exists
 * to fix, wearing a green badge. The screen therefore shows "Live" only on a full house and
 * "Polling" otherwise, and the poll genuinely is still running underneath.
 *
 * <h3>No beep</h3>
 *
 * `useKdsSocket` beeps on a new ticket because a cook has their back to the board. The pass
 * hangs beside those same boards; a second chime for the same event is noise, and the frames
 * that matter most here (an item going ready) are not new tickets at all.
 */
export function useKdsExpoSocket({
  branchId,
  stationCodes,
}: UseKdsExpoSocketOptions): UseKdsExpoSocketResult {
  const [connectedCodes, setConnectedCodes] = useState<readonly string[]>([]);
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((s) => s.session?.accessToken);

  // A stable primitive so the effect does not tear down every socket whenever the station
  // query hands back a new array instance with identical contents (it does, on every poll).
  const codesKey = useMemo(() => [...stationCodes].sort().join(","), [stationCodes]);
  const codes = useMemo(() => (codesKey ? codesKey.split(",") : []), [codesKey]);

  useEffect(() => {
    const codes = codesKey ? codesKey.split(",") : [];
    if (!accessToken || !branchId || codes.length === 0) return;

    let destroyed = false;
    const open = new Set<string>();
    const sockets = new Map<string, WebSocket>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const backoff = new Map<string, number>(codes.map((c) => [c, INITIAL_BACKOFF_MS]));

    function publish() {
      if (destroyed) return;
      setConnectedCodes([...open].sort());
    }

    function openSocket(code: string) {
      if (destroyed) return;
      const ws = new WebSocket(
        wsUrl(`/api/v1/kitchen/kds/${branchId}/${code}?token=${accessToken}`),
      );
      sockets.set(code, ws);

      ws.onopen = () => {
        open.add(code);
        backoff.set(code, INITIAL_BACKOFF_MS);
        publish();
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string) as unknown;
          const ticket: KdsTicket = adaptKdsTicket(apiKdsTicketSchema.parse(raw));
          // The BRANCH-WIDE key (no station segment) — the one the pass reads. Replace in
          // place when known, append when it is a check the pass has not seen yet.
          queryClient.setQueryData<KdsTicket[]>(queryKeys.kds.tickets(branchId), (prev = []) => {
            const idx = prev.findIndex((t) => t.id === ticket.id);
            if (idx === -1) return [...prev, ticket];
            const next = [...prev];
            next[idx] = ticket;
            return next;
          });
        } catch {
          // Ignore malformed frames — never let one bad frame take the pass down.
        }
      };

      ws.onclose = () => {
        sockets.delete(code);
        open.delete(code);
        publish();
        if (destroyed) return;
        const delay = Math.min(backoff.get(code) ?? INITIAL_BACKOFF_MS, MAX_BACKOFF_MS);
        backoff.set(code, Math.min(delay * 2, MAX_BACKOFF_MS));
        timers.set(
          code,
          setTimeout(() => openSocket(code), delay),
        );
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    for (const code of codes) openSocket(code);

    return () => {
      destroyed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      for (const ws of sockets.values()) ws.close();
    };
  }, [branchId, codesKey, accessToken, queryClient]);

  // Intersected with the CURRENT station list rather than reset inside the effect. A station
  // that has gone away must stop counting towards "Live" the moment it does, and clearing the
  // set with a setState in the effect body is the cascading-render shape the lint rule (and
  // React) refuse — so the stale entries are filtered on read instead of erased on write.
  const stationCount = codes.length;
  const connectedCount = connectedCodes.filter((code) => codes.includes(code)).length;
  return {
    isConnected: stationCount > 0 && connectedCount === stationCount,
    connectedCount,
    stationCount,
  };
}
