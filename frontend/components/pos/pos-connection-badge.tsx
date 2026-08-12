"use client";

import { useEffect, useState } from "react";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { onProgress, emitProgress } from "@/lib/offline/sync-engine";
import { cn } from "@/lib/utils";

interface PosConnectionBadgeProps {
  /** Branch order WebSocket state (`usePosOrdersSocket`). */
  isConnected: boolean;
}

/**
 * The till's connection badge.
 *
 * <p>It used to read `isConnected ? "Live" : "Polling"` and nothing else — and a
 * WebSocket is NOT torn down when the OS/browser loses the network, so with the line
 * down it kept reporting a green <b>Live</b> while every request on the page was
 * failing. That was S0-07's third defect: the one indicator a cashier glances at to
 * decide whether the kitchen is receiving their tickets was affirmatively wrong at
 * exactly the moment it mattered.
 *
 * <p>Connectivity now outranks socket state, because a live socket claim is meaningless
 * when the browser itself says there is no network:
 *
 * <ul>
 *   <li><b>Offline</b> — `navigator.onLine` is false. Shows the queue depth, so the
 *       cashier can see their tickets are held rather than lost.
 *   <li><b>Live</b> — online and the branch order socket is up; kitchen updates arrive
 *       the instant they happen.
 *   <li><b>Polling</b> — online but the socket is down; the 15s fallback poll is
 *       carrying updates.
 * </ul>
 *
 * No `transform`/`filter`/`backdrop-filter` — this sits in a POS layout ancestor and
 * those break the receipt print path.
 */
export function PosConnectionBadge({ isConnected }: PosConnectionBadgeProps) {
  const { isOnline } = useOnlineStatus();
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const unsubscribe = onProgress((pending) => setQueued(pending));
    // No IndexedDB (private browsing, jsdom) means no outbox and nothing queued — the
    // badge still has to tell the truth about the CONNECTION, which is the point of it.
    emitProgress().catch(() => undefined);
    return unsubscribe;
  }, []);

  const state = !isOnline ? "offline" : isConnected ? "live" : "polling";

  const label =
    state === "offline"
      ? queued > 0
        ? `Offline — ${queued} queued`
        : "Offline"
      : state === "live"
        ? "Live"
        : "Polling";

  const title =
    state === "offline"
      ? "Offline — orders are queued on this device and send when the connection returns"
      : state === "live"
        ? "Live — kitchen updates in real time"
        : "Polling — reconnecting";

  // Offline is the strongest signal on the screen: it is the difference between "the
  // kitchen has your ticket" and "it is sitting in this tablet".
  const tone =
    state === "live" ? "text-success" : state === "polling" ? "text-warning" : "text-destructive";
  const dotTone =
    state === "live" ? "bg-success" : state === "polling" ? "bg-warning" : "bg-destructive";

  return (
    <span
      data-testid="pos-live-indicator"
      data-connection-state={state}
      title={title}
      aria-live="polite"
      className={cn("ml-auto mb-2 inline-flex items-center gap-1.5 text-small font-medium", tone)}
    >
      <span className={cn("h-2 w-2 rounded-full", dotTone)} />
      {label}
    </span>
  );
}
