"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a fixed warning banner at the top of the POS layout when the client is
 * offline. Shows a brief "Back online" flash on reconnect (3s), then disappears.
 *
 * <h3>Semantic tokens, not raw Tailwind palette literals (G3)</h3>
 *
 * `bg-amber-500`/`text-amber-950` and `bg-green-600`/`text-white` were hard-coded hues that
 * follow neither the theme nor `--brand-h`, so this banner stayed the same amber when the tenant
 * re-branded and did not re-tune for dark. They are now `bg-warning`/`text-warning-foreground`
 * and `bg-success`/`text-success-foreground` — the pairs `design-tokens.test.ts` asserts at
 * 8.25:1 light / 8.64:1 dark (warning) and 5.27:1 light / 9.16:1 dark (success), so the swap
 * is measured rather than assumed. `--warning` resolves to the same amber-400 in both themes,
 * which is why the offline banner still looks like itself.
 *
 * <h3>D-38-13 §4.2 — hue is not the only signal here, and was not before</h3>
 *
 * Both banners already state the condition in words ("Offline — Orders will sync…",
 * "Back online — syncing orders…") and both carry a live region role (`alert` / `status`), so
 * the state survives greyscale, colour-blindness and a screen reader with no icon added. The
 * `size-2` dot is decoration on both banners — it was never the differentiator — so it is
 * tokenised to the banner's own foreground and left alone.
 *
 * Subscribes directly to the browser's online/offline events rather than calling
 * setState inside an effect body (which triggers the react-hooks/set-state-in-effect
 * lint rule).
 */
export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(typeof window === "undefined" ? true : navigator.onLine);
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
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-success px-4 py-2 text-sm font-medium text-success-foreground shadow-md"
      >
        <span className="size-2 rounded-full bg-success-foreground" />
        Back online — syncing orders…
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="offline-banner"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground shadow-md"
    >
      <span className="size-2 rounded-full bg-warning-foreground/40" />
      Offline — Orders will sync when connection returns
    </div>
  );
}
