"use client";

let registration: ServiceWorkerRegistration | null = null;

/**
 * Register the POS service worker. Safe to call multiple times — subsequent
 * calls are no-ops if the SW is already registered.
 *
 * Only runs in the browser (guards against SSR), and only on HTTPS or localhost
 * (the two origins where service workers are allowed by browsers).
 */
export async function registerSW(): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    registration !== null
  ) {
    return;
  }

  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    registration.addEventListener("updatefound", () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          // New SW is installed and waiting — signal skip-waiting.
          installing.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  } catch {
    // Registration failures are non-fatal — the app works without the SW.
  }
}

export function getRegistration(): ServiceWorkerRegistration | null {
  return registration;
}
