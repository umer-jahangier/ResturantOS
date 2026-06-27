import { type NextRequest, NextResponse } from "next/server";

// Clears the `has_session` UX-marker cookie server-side. Called by the logout
// flow after POST /api/v1/auth/logout so that proxy.ts and the server DAL see
// the session as gone on the very next server render — even before the client
// has a chance to run JavaScript.
//
// The client-side clearSession() already removes the cookie via document.cookie,
// but this route acts as a belt-and-suspenders for SSR paths and for cases where
// the client JS execution is interrupted (e.g. hard reload during logout).
export function POST(_request: NextRequest): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("has_session", "", {
    path: "/",
    sameSite: "strict",
    maxAge: 0,
  });
  return response;
}
