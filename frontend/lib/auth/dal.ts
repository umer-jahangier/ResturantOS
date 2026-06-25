import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";

// Server-only Data Access Layer — the REAL server-side seam (proxy.ts is only an
// optimistic UX hint). Reads the same broadly-scoped `has_session` marker, since
// the HttpOnly `refresh_token` is Path=/api/v1/auth and not sent on app routes.
//
// `cache()` dedupes the cookie read within a single server render. Full
// server-side validation/refresh against the gateway is a later hardening step.
export const getServerSession = cache(async () => {
  const jar = await cookies();
  return {
    hasSession: Boolean(jar.get("has_session")?.value),
  };
});
