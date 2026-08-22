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

  /*
   * Offline is the strongest signal on the screen: it is the difference between "the kitchen
   * has your ticket" and "it is sitting in this tablet".
   *
   * <h3>Why `polling` names ramp stops and the other two name semantic tokens</h3>
   *
   * `--warning` is a FILL token, not an ink one, and it is the only semantic colour in the
   * system that does not flip stop between themes. Measured live on `/app/pos` on 2026-08-22,
   * against this badge's own surface, with the app's own stylesheet:
   *
   *     light (--surface-2 = white)          dark (--surface-2 = oklch(.132 .014 260))
   *     --warning     = warning-400  2.33:1  ✘   --warning     = warning-400  8.62:1  ✔
   *     --success     = success-600  5.26:1  ✔   --success     = success-400  9.18:1  ✔
   *     --destructive = danger-600   6.90:1  ✔   --destructive = danger-400   8.15:1  ✔
   *
   * Every other semantic ink token is a 600 stop in light and a 400 in dark. `--warning` is
   * pinned at `warning-400` in BOTH (`globals.css:596` and `:874`) because it also has to work
   * as `bg-warning` under `--warning-foreground: --neutral-950` — near-black ink on amber, 8.24:1,
   * which a 600-stop fill would drop to 3.70:1. So the token is right and using it as 13px text
   * on a light surface was the bug: **2.33:1 against a 4.5:1 floor (SC 1.4.3)**, reported by
   * axe-core as the one serious violation on the whole POS terminal.
   *
   * Re-pointing `--warning` itself would trade one violation for every `bg-warning` surface in
   * the product, so the pairing is made here, at the ink call site, exactly as
   * `components/ui/activity-row.tsx:129` and `app/(tenant)/app/dashboard/realtime/page.tsx:61`
   * already do it. Measured after: **7.46:1 light, 8.62:1 dark**.
   *
   * <p>This badge is stuck on `polling` wherever the WebSocket upgrade is not forwarded at the
   * edge, which is what made the violation visible — but the pairing is what was wrong, and it
   * is wrong whether or not the socket ever connects. Fixing the proxy would have hidden this,
   * not fixed it.
   */
  const tone =
    state === "live"
      ? "text-success"
      : state === "polling"
        ? "text-warning-700 dark:text-warning-400"
        : "text-destructive";
  const dotTone =
    state === "live"
      ? "bg-success"
      : state === "polling"
        ? "bg-warning-700 dark:bg-warning-400"
        : "bg-destructive";

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
