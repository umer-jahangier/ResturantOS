"use client";

import { useMemo } from "react";

import { useSessionStore } from "@/lib/auth/session";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * Is the current principal entitled to the platform control plane? (19c, GA-002)
 *
 * <h3>The defect this closes</h3>
 *
 * `/platform/**` was AUTHENTICATED and never AUTHORIZED. `proxy.ts:51-58` gates the prefix on the
 * presence of the `has_session` cookie and nothing else — a cookie that is non-HttpOnly, forgeable
 * by design (it is an explicit UX hint), and set for **every** logged-in user of every tenant. A
 * KITCHEN_STAFF who typed `/platform/dashboard` was served the SuperAdmin shell.
 *
 * No tenant data leaked, because the gateway refuses `/api/v1/platform/**` without SUPER_ADMIN and
 * that refusal is real. But the console rendered — a control plane the user is not entitled to
 * see, every panel wired to an API that answers 403.
 *
 * <h3>Why the check lives here and not in proxy.ts</h3>
 *
 * `proxy.ts` **cannot** do this, even in principle. The access JWT is memory-only and the HttpOnly
 * refresh token is scoped to `Path=/api/v1/auth`, so no request the proxy sees carries a role. Any
 * role check there would have to trust the forgeable marker cookie — which is how this class of
 * bug is created, not fixed. The proxy stays what its own comment says it is: a first-pass
 * redirect, not a security boundary.
 *
 * <h3>Why both claims are required</h3>
 *
 * `tokenType === "platform"` alone would admit a future non-SuperAdmin platform role. The
 * `SUPER_ADMIN` claim alone would admit a tenant-scoped token that somehow carried it. Requiring
 * both means a principal must be BOTH tenant-less AND a SuperAdmin — which is exactly what
 * `JwtSigningService.signPlatformToken` mints and nothing else does.
 *
 * Both facts are read from the RS256-verified access token via `useCurrentUser` / the session
 * store, not from a cookie and not from a header.
 */
export interface PlatformSession {
  /** Still exchanging the refresh token. Neither entitled nor refused yet — do not redirect. */
  isResolving: boolean;
  /** A session exists. */
  isAuthenticated: boolean;
  /** Tenant-less control-plane token. */
  isPlatformToken: boolean;
  /** Carries the SUPER_ADMIN role claim. */
  isSuperAdmin: boolean;
  /** Both of the above. The only condition under which the console renders. */
  isEntitled: boolean;
  platformUserId: string;
}

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

export function usePlatformSession(): PlatformSession {
  const session = useSessionStore((state) => state.session);
  const isBootstrapping = useSessionStore((state) => state.isBootstrapping);
  const { isAuthenticated, roles, userId } = useCurrentUser();

  return useMemo<PlatformSession>(() => {
    const isPlatformToken = session?.tokenType === "platform";
    const isSuperAdmin = roles.includes(SUPER_ADMIN_ROLE);

    return {
      isResolving: isBootstrapping,
      isAuthenticated,
      isPlatformToken,
      isSuperAdmin,
      isEntitled: isAuthenticated && isPlatformToken && isSuperAdmin,
      platformUserId: userId,
    };
  }, [session, isBootstrapping, isAuthenticated, roles, userId]);
}
