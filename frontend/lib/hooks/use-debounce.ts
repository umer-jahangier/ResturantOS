"use client";

import { useEffect, useState } from "react";

/**
 * Debounces `value`, returning the previous value until `delayMs` has elapsed with no further
 * change. Callers pass 400 for the UI contract's recompute debounce (08.2-UI-SPEC.md Screen 3's
 * "Live" contract — the plate-cost panel's server-round-trip recompute trigger).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
