/**
 * RestaurantOS POS Service Worker — compiled output.
 * Source: workbox/sw.ts
 *
 * Caching strategy:
 *  - SHELL_CACHE: POS app shell + the offline shell document, precached on install.
 *  - STATIC_CACHE: Next.js _next/static/* chunks (content-hashed → CacheFirst).
 *  - API_CACHE: GET /api/v1/pos/menu* and /tables* (StaleWhileRevalidate).
 *  - NetworkOnly: all mutations + close/payments/void/refund/tills routes.
 *  - Navigation: NetworkFirst → cached /app/pos → /offline.html.
 *
 * MODES (S0-07). The registration URL carries `?mode=dev|prod` (see lib/offline/
 * sw-register.ts). In `dev` this worker registers a NAVIGATION FALLBACK ONLY: it caches
 * no chunk and no API response, because under `next dev` the bundles are not
 * content-hashed and a CacheFirst hit traps whatever was cached at install time — the
 * stale-chunk trap that once cost hours of "fixed it, still broken". A dev worker is
 * registered anyway because without ANY worker, reloading the till while offline gives
 * net::ERR_INTERNET_DISCONNECTED and a blank white page, which is what a cashier
 * actually saw.
 */

const CACHE_VERSION = "v2";
const SHELL_CACHE = `restaurantos-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `restaurantos-static-${CACHE_VERSION}`;
const API_CACHE = `restaurantos-api-${CACHE_VERSION}`;

/** The standalone offline document — never a Next.js route, so it survives any bundle. */
const OFFLINE_URL = "/offline.html";
const POS_SHELL_URL = "/app/pos";

const MODE = new URL(self.location.href).searchParams.get("mode") === "dev" ? "dev" : "prod";
const CACHE_APP_ASSETS = MODE === "prod";

const SHELL_URLS = CACHE_APP_ASSETS ? [POS_SHELL_URL, OFFLINE_URL] : [OFFLINE_URL];

const NETWORK_ONLY_PATTERNS = [
  /\/api\/v1\/pos\/orders\/[^/]+\/close/,
  /\/api\/v1\/pos\/orders\/[^/]+\/payments/,
  /\/api\/v1\/pos\/orders\/[^/]+\/void/,
  /\/api\/v1\/pos\/orders\/[^/]+\/refund/,
  /\/api\/v1\/pos\/tills/,
];

const SWR_PATTERNS = [/\/api\/v1\/pos\/menu/, /\/api\/v1\/pos\/tables/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is all-or-nothing: one 404 (a route that needs auth, say) would abort the
      // whole install and leave NO offline document at all. Cache each entry on its own.
      .then((cache) =>
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
          ),
        ),
      )
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET" || NETWORK_ONLY_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(fetch(request));
    return;
  }

  // A navigation is the ONE request whose failure the user sees as a blank page, so it
  // is handled in every mode.
  if (request.mode === "navigate") {
    event.respondWith(navigationWithOfflineShell(request));
    return;
  }

  if (!CACHE_APP_ASSETS) return;

  if (SWR_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
});

/**
 * NetworkFirst, then the cached POS shell, then the standalone offline document.
 *
 * The last fallback is what turns "blank white till" into a screen that says the line is
 * down and how many tickets are still queued on the device.
 */
async function navigationWithOfflineShell(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const shell = CACHE_APP_ASSETS ? await caches.match(POS_SHELL_URL) : undefined;
    if (shell) return shell;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

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
