"use client";

import { useEffect, useRef, useState } from "react";
import { onProgress, replay } from "@/lib/offline/sync-engine";
import { cn } from "@/lib/utils";

interface SyncState {
  pending: number;
  lastError?: string;
  replaying: boolean;
  /** True for a brief window after `pending` drops to 0, to show "All synced" before fading. */
  showSynced: boolean;
}

/** UI-SPEC Copywriting Contract: "All synced" auto-fades after 2s, no manual dismiss. */
const SYNCED_FADE_MS = 2000;

/**
 * Subscribes to sync-engine progress and shows:
 * - "{n} queued" the instant an offline mutation is enqueued (enqueue() itself now
 *   calls emitProgress() — POS-14/POS-07 UAT gap, previously this only updated on
 *   mount/reconnect/replay()).
 * - "Syncing…" while replay is running.
 * - "All synced" for a couple of seconds after the outbox drains, then fades (renders
 *   nothing again).
 * - A "Retry now" button while ops are pending.
 *
 * Renders nothing when pending = 0, no error, and the post-drain "All synced" window
 * has elapsed.
 */
export function SyncStatusBadge() {
  const [state, setState] = useState<SyncState>({
    pending: 0,
    replaying: false,
    showSynced: false,
  });
  const replayingRef = useRef(false);
  const prevPendingRef = useRef(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onProgress((pending, lastError) => {
      const justDrained = prevPendingRef.current > 0 && pending === 0 && !lastError;
      prevPendingRef.current = pending;

      if (justDrained) {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          setState((prev) => ({ ...prev, showSynced: false }));
        }, SYNCED_FADE_MS);
      }

      setState((prev) => ({
        ...prev,
        pending,
        lastError,
        showSynced: justDrained || (prev.showSynced && pending === 0 && !lastError),
      }));
    });
    return () => {
      unsubscribe();
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const handleRetry = async () => {
    if (replayingRef.current) return;
    replayingRef.current = true;
    setState((prev) => ({ ...prev, replaying: true }));
    try {
      await replay();
    } finally {
      replayingRef.current = false;
      setState((prev) => ({ ...prev, replaying: false }));
    }
  };

  if (state.pending === 0 && !state.lastError && !state.showSynced) return null;

  const label = state.replaying
    ? "Syncing…"
    : state.pending > 0
      ? `${state.pending} queued`
      : "All synced";

  return (
    <div
      data-testid="sync-badge"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-md"
      aria-live="polite"
      aria-label={`${state.pending} order${state.pending !== 1 ? "s" : ""} pending sync`}
    >
      {state.replaying ? (
        <span className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      ) : (
        <span className={cn("size-2 rounded-full", state.pending > 0 ? "bg-warning" : "bg-success")} />
      )}

      <span>{label}</span>

      {state.lastError && (
        <span
          className="max-w-[12rem] truncate text-destructive"
          title={state.lastError}
        >
          — {state.lastError}
        </span>
      )}

      {state.pending > 0 && (
        <button
          onClick={() => void handleRetry()}
          disabled={state.replaying}
          className="ml-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          Retry now
        </button>
      )}
    </div>
  );
}
