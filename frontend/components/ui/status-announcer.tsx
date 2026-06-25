"use client";

import { useCallback, useEffect, useRef, useState } from "react";

let globalSetMessage: ((message: string) => void) | null = null;

/**
 * Renders a visually hidden `aria-live="polite"` region that screen readers
 * announce when content changes. Mount once in the root layout or app providers.
 */
export function StatusAnnouncer() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    globalSetMessage = (msg: string) => setMessage(msg);
    return () => {
      globalSetMessage = null;
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * Hook that returns an `announce` function. Call it to push a message to the
 * live region. The message is cleared after `clearAfterMs` (default 3000 ms).
 */
export function useStatusAnnouncer(clearAfterMs = 3000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback(
    (message: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      globalSetMessage?.(message);
      timerRef.current = setTimeout(() => {
        globalSetMessage?.("");
      }, clearAfterMs);
    },
    [clearAfterMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { announce };
}
