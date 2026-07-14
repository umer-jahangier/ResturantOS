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

function loginUrl(request: NextRequest): URL {
  const url = new URL("/login", request.url);
  const defaultTenant = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG?.trim();
  if (defaultTenant) {
    url.searchParams.set("tenant", defaultTenant);
  }
  return url;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Dev default tenant: hide the restaurant slug field on /login.
  if (pathname === "/login" && !request.nextUrl.searchParams.get("tenant")) {
    const defaultTenant = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG?.trim();
    if (defaultTenant) {
      const url = request.nextUrl.clone();
      url.searchParams.set("tenant", defaultTenant);
      return NextResponse.redirect(url);
    }
  }

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
