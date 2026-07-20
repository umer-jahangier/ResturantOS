// Resolves the WebSocket base URL for all browser socket hooks.
//
// Reads NEXT_PUBLIC_WS_BASE_URL — a FULL ws:// / wss:// base (e.g. ws://localhost:8080),
// set by scripts/start-dev.sh and deploy/.env, defaulted in frontend/lib/env.ts. In dev this
// points at the real gateway (:8080), which performs the ?token= JWT WS handshake (GAP A / 12-12).
//
// When the var is unset/empty (e.g. production behind Nginx, which proxies WS upgrades on the same
// origin), it falls back to a window.location-derived same-origin base. It NEVER re-prepends a
// scheme to a value that already carries one — the historical bug was building `${protocol}//${host}`
// from an unset NEXT_PUBLIC_*_WS_URL, silently targeting localhost:3000 (the Next dev server, which
// does not proxy WS upgrades).

// Read the raw process.env (not the env.ts defaulted object) so an UNSET var yields the same-origin
// fallback in production. Next.js statically inlines this literal reference at build time.
const CONFIGURED_WS_BASE = process.env.NEXT_PUBLIC_WS_BASE_URL;

/** Full ws:// / wss:// origin (no trailing slash). Full base when configured, else same-origin. */
export function resolveWsBaseUrl(): string {
  if (CONFIGURED_WS_BASE && CONFIGURED_WS_BASE.length > 0) {
    return CONFIGURED_WS_BASE.replace(/\/+$/, "");
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

/** Build a full WS URL from an absolute path (must start with "/"), e.g. "/api/v1/...". */
export function wsUrl(path: string): string {
  return `${resolveWsBaseUrl()}${path}`;
}
