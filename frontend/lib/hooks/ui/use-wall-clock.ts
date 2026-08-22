"use client";

import { useEffect, useState } from "react";

/**
 * One reading of the wall clock, taken at mount and held.
 *
 * <h3>Why the clock cannot be read during render</h3>
 *
 * `react-hooks/purity` rejects `Date.now()` in a render body, and it is right to: a value that
 * changes every millisecond makes the render impure, and any label derived from it renders one
 * string on the server and a different one in the browser milliseconds later — which React
 * reconciles as a text mismatch. A lazy `useState` INITIALISER is the sanctioned form (three
 * existing call sites use it: `dashboard-shell.tsx`, `table-floor-view.tsx`,
 * `order-management.tsx`) because it runs once per mount rather than once per render.
 *
 * <h3>Why it does not tick by default</h3>
 *
 * A relative label on a landing page does not need to be correct to the second — it needs to be
 * correct when the reader looks at it, and a refetch or a navigation re-mounts it anyway. An
 * interval is a timer running for a reader who has walked away, and this product already removed
 * one perpetual animation from a wall display for that reason. Pass `intervalMs` only where the
 * age itself is the thing being watched, which on a control plane it is not.
 *
 * @param intervalMs re-read the clock on this interval. Omit for a single reading at mount.
 * @returns epoch milliseconds, suitable as the `now` argument to `lib/format/elapsed.ts`.
 */
export function useWallClock(intervalMs?: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
