"use client";

import { useEffect, useRef, useState } from "react";
import { onProgress, replay } from "@/lib/offline/sync-engine";

interface SyncState {
  pending: number;
  lastError?: string;
  replaying: boolean;
}

/**
 * Subscribes to sync-engine progress and shows:
 * - A count badge when there are pending outbox ops.
 * - A spinner while replay is running.
 * - "All synced" when pending = 0.
 * - A "Retry now" button to manually trigger a replay.
 *
 * Renders nothing when pending = 0 and no error.
 */
export function SyncStatusBadge() {
  const [state, setState] = useState<SyncState>({ pending: 0, replaying: false });
  const replayingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onProgress((pending, lastError) => {
      setState((prev) => ({ ...prev, pending, lastError }));
    });
    return unsubscribe;
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

  if (state.pending === 0 && !state.lastError) return null;

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
        <span className="size-2 rounded-full bg-amber-500" />
      )}

      <span>
        {state.pending > 0 ? (
          <>
            <strong>{state.pending}</strong> pending
          </>
        ) : (
          "All synced"
        )}
      </span>

      {state.lastError && (
        <span
          className="max-w-[12rem] truncate text-destructive"
          title={state.lastError}
        >
          — {state.lastError}
        </span>
      )}

      <button
        onClick={() => void handleRetry()}
        disabled={state.replaying}
        className="ml-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        Retry now
      </button>
    </div>
  );
}
