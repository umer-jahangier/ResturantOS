import { NextResponse, type NextRequest } from "next/server";

// Next 16 renamed middleware.ts → proxy.ts (exported fn `proxy`, Node runtime).
// FE-03 says "middleware.ts" — this is the documented deviation.
//
// OPTIMISTIC route protection ONLY. It reads the non-HttpOnly `has_session` UX
// marker the client sets on login — NOT a security boundary (CVE-2025-29927).
// The access JWT lives in memory and the real `refresh_token` is HttpOnly +
// Path=/api/v1/auth, so NEITHER is visible here. The real gate is the
// server-only DAL (lib/auth/dal.ts) + the gateway's 401 on the access token.

const PROTECTED = ["/platform", "/app"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const hasSession = request.cookies.has("has_session");

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/platform/:path*", "/app/:path*"],
};
