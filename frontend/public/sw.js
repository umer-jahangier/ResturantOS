/**
 * RestaurantOS POS Service Worker — compiled output.
 * Source: workbox/sw.ts
 *
 * Caching strategy:
 *  - SHELL_CACHE: POS app shell, precached on install.
 *  - STATIC_CACHE: Next.js _next/static/* chunks (content-hashed → CacheFirst).
 *  - API_CACHE: GET /api/v1/pos/menu* and /tables* (StaleWhileRevalidate).
 *  - NetworkOnly: all mutations + close/payments/void/refund/tills routes.
 *  - Navigation: NetworkFirst + fallback to cached /app/pos when offline.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `restaurantos-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `restaurantos-static-${CACHE_VERSION}`;
const API_CACHE = `restaurantos-api-${CACHE_VERSION}`;

const SHELL_URLS = ["/app/pos"];

const NETWORK_ONLY_PATTERNS = [
  /\/api\/v1\/pos\/orders\/[^/]+\/close/,
  /\/api\/v1\/pos\/orders\/[^/]+\/payments/,
  /\/api\/v1\/pos\/orders\/[^/]+\/void/,
  /\/api\/v1\/pos\/orders\/[^/]+\/refund/,
  /\/api\/v1\/pos\/tills/,
];

const SWR_PATTERNS = [
  /\/api\/v1\/pos\/menu/,
  /\/api\/v1\/pos\/tables/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== SHELL_CACHE && n !== STATIC_CACHE && n !== API_CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (
    request.method !== "GET" ||
    NETWORK_ONLY_PATTERNS.some((p) => p.test(url.pathname))
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (SWR_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => caches.match("/app/pos").then((r) => r ?? new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  return cached ?? networkFetch;
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}
