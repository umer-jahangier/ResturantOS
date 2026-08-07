import { NextResponse, type NextRequest } from "next/server";

// Next 16 renamed middleware.ts → proxy.ts (exported fn `proxy`, Node runtime).
// FE-03 says "middleware.ts" — this is the documented deviation.
//
// FIRST-PASS route protection only. This redirects browsers that have no
// `has_session` UX-marker cookie at all so they never see the app shell markup.
//
// This is NOT a security boundary. Security is enforced in two real layers:
//   1. SessionProvider (components/providers/session-provider.tsx) — runs on every
//      client page load and calls POST /api/v1/auth/refresh. A forged `has_session`
//      cookie will fail here (the HttpOnly refresh token is absent or revoked) and
//      the user is redirected to /login.
//   2. Gateway — every API request carries the in-memory Bearer token. A 401 triggers
//      a refresh attempt; on failure the axios interceptor clears the session and
//      the user lands on /login.
//
// The access JWT is never stored in a cookie (memory-only), and the HttpOnly
// `refresh_token` is scoped to Path=/api/v1/auth, so neither is visible here.

const PROTECTED = ["/platform", "/app"];

/**
 * Where an unauthenticated request to a protected route is sent.
 *
 * <b>`/login`. Bare. No `?tenant=`.</b> This function used to append
 * `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`, and there used to be a second rule above that redirected any
 * `/login` without a `?tenant=` to one carrying it. Together they meant every visitor — including
 * the SuperAdmin, who belongs to no tenant — was pinned to one hard-coded slug, and when that slug
 * went stale (`test`, which no longer exists) the login page was unusable for everyone.
 *
 * The dev convenience it was reaching for is real but belongs one layer up: `?tenant=` still works
 * as a hint, and the page still PREFILLS from it. What it must not do is REWRITE the URL, because a
 * redirect makes the hint mandatory and unremovable — a user who deletes the query string is simply
 * given it back.
 */
function loginUrl(request: NextRequest): URL {
  return new URL("/login", request.url);
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Bare `/dashboard` is not a real route — the tenant dashboard lives at
  // `/app/dashboard`. Normalise it so bookmarks and direct navigation work.
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const rest = pathname.slice("/dashboard".length);
    return NextResponse.redirect(new URL(`/app/dashboard${rest}`, request.url));
  }

  const isProtected = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const hasSession = request.cookies.has("has_session");

  if (isProtected && !hasSession) {
    return NextResponse.redirect(loginUrl(request));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/platform/:path*", "/app/:path*", "/dashboard", "/dashboard/:path*"],
};
