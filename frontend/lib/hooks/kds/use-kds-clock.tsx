"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Single shared "now" tick for the whole KDS board (KDS-05/D-13, T-07.3-31) — ONE
// setInterval instead of one per ticket card. Replaces the old per-card
// `useTicketAge` (kds-ticket-card.tsx pre-07.3-10) so the board scales to many
// simultaneous tickets without accumulating a timer per card.
const KDS_CLOCK_TICK_MS = 10_000;

// `null` default (rather than a frozen Date.now() captured at module-eval time) so
// a consumer used outside a provider (e.g. an isolated component test) computes a
// fresh Date.now() per read instead of a stale fixed timestamp — see useKdsClock.
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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), KDS_CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return <KdsClockContext.Provider value={now}>{children}</KdsClockContext.Provider>;
}

/**
 * Reads the shared KDS clock tick (ms since epoch, updates every 10s). Falls back
 * to a one-shot (non-ticking) `Date.now()` read when used outside a
 * `KdsClockProvider` — e.g. isolated unit tests that don't need live ticking.
 */
export function useKdsClock(): number {
  const contextNow = useContext(KdsClockContext);
  return contextNow ?? Date.now();
}
