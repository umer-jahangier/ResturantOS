/**
 * POS Service Worker — source TypeScript.
 *
 * This file is the AUTHORITATIVE source. The compiled output lives at
 * public/sw.js, which is served by Next.js from the public directory.
 *
 * Caching strategy summary:
 *  - Precache: POS app shell (/app/pos) + Next.js static chunks (_next/static/)
 *  - StaleWhileRevalidate: GET /api/v1/pos/menu* and /api/v1/pos/tables*
 *    (reference data; stale reads are fine offline, background refresh on reconnect)
 *  - NetworkOnly: ALL mutations (POST/PATCH/PUT/DELETE) AND the money-sensitive
 *    endpoints close / payments / void / refund / tills regardless of method.
 *    These MUST hit the authoritative server (period-lock, OPA thresholds, JEs).
 *  - NetworkFirst + offline fallback to /app/pos: browser navigation requests.
 *  - CacheFirst: _next/static/* (content-hashed, safe to cache forever).
 */

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "v1";
const SHELL_CACHE = `restaurantos-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `restaurantos-static-${CACHE_VERSION}`;
const API_CACHE = `restaurantos-api-${CACHE_VERSION}`;

const SHELL_URLS = ["/app/pos"];

// These patterns are NEVER cached — network failure = operation failure.
const NETWORK_ONLY_PATTERNS: RegExp[] = [
  /\/api\/v1\/pos\/orders\/[^/]+\/close/,
  /\/api\/v1\/pos\/orders\/[^/]+\/payments/,
  /\/api\/v1\/pos\/orders\/[^/]+\/void/,
  /\/api\/v1\/pos\/orders\/[^/]+\/refund/,
  /\/api\/v1\/pos\/tills/,
];

// GET requests for reference data use StaleWhileRevalidate.
const SWR_PATTERNS: RegExp[] = [
  /\/api\/v1\/pos\/menu/,
  /\/api\/v1\/pos\/tables/,
];

// ── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => (self as ServiceWorkerGlobalScope).skipWaiting()),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (n) => n !== SHELL_CACHE && n !== STATIC_CACHE && n !== API_CACHE,
            )
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => (self as ServiceWorkerGlobalScope).clients.claim()),
  );
});

// ── Fetch routing ─────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // NetworkOnly for mutations or money-sensitive routes.
  if (
    request.method !== "GET" ||
    NETWORK_ONLY_PATTERNS.some((p) => p.test(url.pathname))
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // StaleWhileRevalidate for menu + table reference GETs.
  if (SWR_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // CacheFirst for immutable Next.js static chunks.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // NavigationFirst with POS shell offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          caches.match("/app/pos") ??
          new Response("Offline", { status: 503 }),
      ),
    );
    return;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function staleWhileRevalidate(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  return cached ?? networkFetch;
}

async function cacheFirst(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}
