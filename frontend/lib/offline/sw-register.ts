"use client";

let registration: ServiceWorkerRegistration | null = null;

/**
 * Register the POS service worker. Safe to call multiple times — subsequent
 * calls are no-ops if the SW is already registered.
 *
 * Only runs in the browser (guards against SSR), and only on HTTPS or localhost
 * (the two origins where service workers are allowed by browsers).
 *
 * Skipped outside production: the SW's CacheFirst strategy for /_next/static/*
 * is only safe for content-hashed production chunks. Under `next dev` it
 * traps whatever bundle was cached at install time, so edits to app code never
 * reach the browser again until the SW is manually unregistered — a stale-chunk
 * trap that once cost hours of "fixed it, still broken" debugging (see
 * e2e/pos-settlement.spec.ts's SW-neutralizing initScript for the same issue).
 */
export async function registerSW(): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    registration !== null ||
    process.env.NODE_ENV !== "production"
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
