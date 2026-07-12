"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a fixed amber banner at the top of the POS layout when the client is
 * offline. Shows a brief "Back online" flash on reconnect (3s), then disappears.
 *
 * Subscribes directly to the browser's online/offline events rather than calling
 * setState inside an effect body (which triggers the react-hooks/set-state-in-effect
 * lint rule).
 */
export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof window === "undefined" ? true : navigator.onLine,
  );
  const [showReconnected, setShowReconnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOfflineRef = useRef(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        setShowReconnected(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setShowReconnected(false), 3000);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOfflineRef.current = true;
      setShowReconnected(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (isOnline && !showReconnected) return null;

  if (showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="online-reconnected-banner"
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-md"
      >
        <span className="size-2 rounded-full bg-white" />
        Back online — syncing orders…
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="offline-banner"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 shadow-md"
    >
      <span className="size-2 rounded-full bg-amber-950/40" />
      Offline — Orders will sync when connection returns
    </div>
  );
}
