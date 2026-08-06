"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

// Single shared "now" tick for the whole KDS board (KDS-05/D-13, T-07.3-31) — ONE
// setInterval instead of one per ticket card. Replaces the old per-card
// `useTicketAge` (kds-ticket-card.tsx pre-07.3-10) so the board scales to many
// simultaneous tickets without accumulating a timer per card.
const KDS_CLOCK_TICK_MS = 10_000;

// ── Module-level ticking clock ────────────────────────────────────────────────
// `useKdsClock` used to fall back to a bare `Date.now()` read when no provider was
// mounted. That is an impure render (React may re-run a render at any time and get a
// different answer), and it silently produced a FROZEN age for any surface that had no
// provider — the value only changed when something else caused a re-render.
//
// The clock is now an external store read through `useSyncExternalStore`, which is the
// supported way to read a mutable outside-React value during render. One interval is
// shared by every subscriber, started on the first subscription and cleared when the
// last one leaves, so the "one timer, not one per card" property still holds — now
// app-wide rather than per-provider.
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let snapshot = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    // Re-read on (re)start: the module may have been evaluated long before this mount,
    // which would otherwise serve an arbitrarily stale first snapshot. React re-reads
    // the snapshot immediately after subscribing, so this is picked up without a tick.
    snapshot = Date.now();
    intervalId = setInterval(() => {
      snapshot = Date.now();
      for (const listener of listeners) listener();
    }, KDS_CLOCK_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

/** Cached — `useSyncExternalStore` requires a snapshot that is stable between ticks. */
function getSnapshot(): number {
  return snapshot;
}

/** The server has no timer; one fixed value per render pass keeps hydration stable. */
function getServerSnapshot(): number {
  return snapshot;
}

// `null` default so `useKdsClock` can tell "no provider" apart from a real tick and
// fall back to the shared store rather than to a frozen timestamp.
const KdsClockContext = createContext<number | null>(null);

interface KdsClockProviderProps {
  children: ReactNode;
}

/**
 * Provides one shared ticking "now" (ms since epoch) to every descendant that calls
 * `useKdsClock()`. Mount once per board/detail surface — every ticket card/timer
 * chip under it re-renders together on the same 10s tick instead of each owning its
 * own interval.
 */
export function KdsClockProvider({ children }: KdsClockProviderProps) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return <KdsClockContext.Provider value={now}>{children}</KdsClockContext.Provider>;
}

/**
 * Reads the shared KDS clock tick (ms since epoch, updates every 10s). Works with or
 * without a `KdsClockProvider` above it: without one it subscribes to the same shared
 * module-level clock directly, so an isolated surface still ticks live instead of
 * freezing at whatever `Date.now()` happened to be on its last render.
 */
export function useKdsClock(): number {
  const contextNow = useContext(KdsClockContext);
  const storeNow = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return contextNow ?? storeNow;
}
