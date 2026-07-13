"use client";

import { useEffect, useRef, useState } from "react";
import { onProgress, replay, emitProgress } from "@/lib/offline/sync-engine";
import { retryDead, dismissDead } from "@/lib/offline/outbox";
import { cn } from "@/lib/utils";

interface SyncState {
  pending: number;
  /** Dead-lettered ops (retries exhausted) — surfaced as a distinct "failed" state. */
  dead: number;
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
    dead: 0,
    replaying: false,
    showSynced: false,
  });
  const replayingRef = useRef(false);
  const prevPendingRef = useRef(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onProgress((pending, lastError, dead = 0) => {
      // "Drained" only when nothing is queued AND nothing dead-lettered is waiting.
      const justDrained =
        prevPendingRef.current > 0 && pending === 0 && dead === 0 && !lastError;
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
        dead,
        lastError,
        showSynced:
          justDrained || (prev.showSynced && pending === 0 && dead === 0 && !lastError),
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
      // An explicit retry also revives dead-lettered ops (resets their attempt count).
      if (state.dead > 0) await retryDead();
      await replay();
    } finally {
      replayingRef.current = false;
      setState((prev) => ({ ...prev, replaying: false }));
    }
  };

  const handleDismiss = async () => {
    await dismissDead();
    await emitProgress();
  };

  const hasFailed = state.pending === 0 && state.dead > 0;

  if (state.pending === 0 && state.dead === 0 && !state.showSynced) return null;

  const label = state.replaying
    ? "Syncing…"
    : state.pending > 0
      ? `${state.pending} queued`
      : hasFailed
        ? `${state.dead} failed to sync`
        : "All synced";

  const dotClass = state.pending > 0 ? "bg-warning" : hasFailed ? "bg-destructive" : "bg-success";

  return (
    <div
      data-testid="sync-badge"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-md"
      aria-live="polite"
      aria-label={
        hasFailed
          ? `${state.dead} order${state.dead !== 1 ? "s" : ""} failed to sync`
          : `${state.pending} order${state.pending !== 1 ? "s" : ""} pending sync`
      }
    >
      {state.replaying ? (
        <span className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      ) : (
        <span className={cn("size-2 rounded-full", dotClass)} />
      )}

      <span>{label}</span>

      {state.lastError && (state.pending > 0 || hasFailed) && (
        <span
          className="max-w-[12rem] truncate text-destructive"
          title={state.lastError}
        >
          — {state.lastError}
        </span>
      )}

      {(state.pending > 0 || hasFailed) && (
        <button
          onClick={() => void handleRetry()}
          disabled={state.replaying}
          className="ml-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          Retry now
        </button>
      )}

      {hasFailed && (
        <button
          onClick={() => void handleDismiss()}
          disabled={state.replaying}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
