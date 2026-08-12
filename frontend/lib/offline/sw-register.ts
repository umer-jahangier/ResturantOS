"use client";

let registration: ServiceWorkerRegistration | null = null;

/**
 * Register the POS service worker. Safe to call multiple times — subsequent
 * calls are no-ops if the SW is already registered.
 *
 * Only runs in the browser (guards against SSR), and only on HTTPS or localhost
 * (the two origins where service workers are allowed by browsers).
 *
 * <h2>Why this now registers in development too (S0-07)</h2>
 * It used to bail out entirely outside production, because the SW's CacheFirst strategy
 * for /_next/static/* is only safe for content-hashed production chunks: under
 * `next dev` it traps whatever bundle was cached at install time, so edits to app code
 * never reach the browser again until the SW is manually unregistered — a stale-chunk
 * trap that once cost hours of "fixed it, still broken" debugging (see
 * e2e/pos-settlement.spec.ts's SW-neutralizing initScript for the same issue).
 *
 * But a service worker is the ONLY thing that can answer a navigation while the network
 * is down, and without one, reloading the till offline produced
 * net::ERR_INTERNET_DISCONNECTED and a blank white page. So the worker is registered in
 * both, with the caching that causes the trap switched OFF in dev: `?mode=dev` makes
 * sw.js a navigation fallback and nothing else — no chunk cache, no API cache. The
 * stale-chunk trap needs a cached chunk, and in dev there is never one.
 */
export async function registerSW(): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    registration !== null
  ) {
    return;
  }

  const mode = process.env.NODE_ENV === "production" ? "prod" : "dev";

  try {
    // The mode rides in the URL because a service worker cannot read process.env: it is
    // a separate script served verbatim from /public, not a bundled module. A changed
    // query string is also a different worker URL, so switching mode re-installs rather
    // than silently keeping the other mode's worker.
    registration = await navigator.serviceWorker.register(`/sw.js?mode=${mode}`, {
      scope: "/",
      updateViaCache: "none",
    });

    registration.addEventListener("updatefound", () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
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
