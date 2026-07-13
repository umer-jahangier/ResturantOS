"use client";

import { useEffect, useState } from "react";

/**
 * Subscribes to window online/offline events for connectivity status.
 *
 * POS-26/D-11: this hook previously also ran a periodic reachability ping (a HEAD
 * request against a relative menu-categories endpoint) — a relative fetch that hit
 * the Next.js origin directly (no gateway rewrite, no auth), producing repeated
 * 404s in the console. That ping has been removed outright; connectivity is now derived
 * purely from the browser's `navigator.onLine` + `online`/`offline` events, per
 * `react-hooks/set-state-in-effect` (setState only inside event callbacks).
 *
 * Returns { isOnline: true } on the server so server-rendered output assumes
 * connectivity, preventing hydration mismatches.
 */
export function useOnlineStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline };
}
