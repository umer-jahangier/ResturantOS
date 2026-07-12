"use client";

import { useEffect, useState } from "react";

const PING_ENDPOINT = "/api/v1/pos/menu/categories";
const PING_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 15_000;

/**
 * Subscribes to window online/offline events and runs a periodic reachability
 * ping to the menu-categories endpoint (short timeout).
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

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const ping = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          PING_TIMEOUT_MS,
        );
        const response = await fetch(PING_ENDPOINT, {
          method: "HEAD",
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeoutId);
        setIsOnline(response.ok);
      } catch {
        setIsOnline(false);
      }
    };

    // Start periodic ping only when browser reports online.
    if (navigator.onLine) {
      intervalId = setInterval(ping, PING_INTERVAL_MS);
    }

    const handleOnlineWithPing = () => {
      setIsOnline(true);
      void ping();
      if (!intervalId) intervalId = setInterval(ping, PING_INTERVAL_MS);
    };

    const handleOfflineWithClear = () => {
      setIsOnline(false);
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnlineWithPing);
    window.addEventListener("offline", handleOfflineWithClear);

    return () => {
      window.removeEventListener("online", handleOnlineWithPing);
      window.removeEventListener("offline", handleOfflineWithClear);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return { isOnline };
}
