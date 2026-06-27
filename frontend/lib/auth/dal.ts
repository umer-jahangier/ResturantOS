import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Server-only Data Access Layer — the true server-side seam for auth checks in
// Server Components and Route Handlers.
//
// WHY this only checks has_session (and not the JWT or branch ID):
//   • The access JWT lives in the browser's memory — it is never stored in a cookie,
//     so it is not available to server-side code on app routes.
//   • The HttpOnly `refresh_token` is scoped to Path=/api/v1/auth, so it is also
//     not forwarded on regular page requests.
//   • Reading `has_session` is therefore the maximum fidelity possible here without
//     an extra round-trip to the auth-service on every server render.
//
// Real auth enforcement happens at two layers that DO have access to the token:
//   1. Client — SessionProvider calls POST /api/v1/auth/refresh on page load; a
//      forged `has_session` cookie will fail this step and redirect to /login.
//   2. Gateway — every API request carries a Bearer token; 401 → refresh attempt,
//      and on failure the client redirects to /login.
//
// `cache()` deduplicates the cookie read within a single server render pass.
export const getServerSession = cache(async () => {
  const jar = await cookies();
  return {
    hasSession: Boolean(jar.get("has_session")?.value),
  };
});

/**
 * Require a session in a Server Component or Route Handler. Redirects to /login
 * when the `has_session` marker is absent.
 *
 * Usage (at the top of a server page or layout):
 * ```ts
 * await requireServerSession();
 * ```
 *
 * This is a UX guard — not a security boundary. See module-level comment above.
 */
export async function requireServerSession(): Promise<void> {
  const { hasSession } = await getServerSession();
  if (!hasSession) {
    redirect("/login");
  }
}
