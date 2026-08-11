"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { usePlatformSession } from "@/lib/hooks/use-platform-session";

/**
 * The authorization gate on `/platform/**` (19c, GA-002).
 *
 * <h3>What was wrong</h3>
 *
 * The route group was authenticated and never authorized. `proxy.ts` redirects a browser with no
 * `has_session` cookie — and that is all it does. `has_session` is non-HttpOnly and set for every
 * logged-in user of every tenant, so a KITCHEN_STAFF who navigated to `/platform/dashboard` was
 * served the SuperAdmin shell in full.
 *
 * No tenant data was exposed: the gateway refuses `/api/v1/platform/**` without SUPER_ADMIN, and
 * that refusal is the real boundary. But a cook was shown a control plane listing every tenant's
 * chrome, with every panel failing 403 behind it. This component is what makes the shell match the
 * entitlement.
 *
 * <h3>Why a component and not middleware</h3>
 *
 * The role is only knowable here. The access JWT is memory-only; the refresh cookie is scoped to
 * `Path=/api/v1/auth`. Nothing the proxy can read carries a role, so a check there could only
 * consult the forgeable marker — which would look like security and provide none.
 *
 * <h3>Resolving is not refused</h3>
 *
 * While `SessionProvider` is exchanging the refresh token there is no token to inspect. Treating
 * that moment as "not entitled" would bounce a legitimate SuperAdmin to an access-denied screen on
 * every hard refresh. It renders a neutral wait instead, and only decides once the exchange has
 * resolved either way.
 */
export function PlatformGuard({ children }: { children: React.ReactNode }) {
  const { isResolving, isAuthenticated, isEntitled } = usePlatformSession();

  if (isResolving || (!isAuthenticated && typeof window !== "undefined")) {
    // Neither entitled nor refused yet. `SessionProvider` redirects to /login if the exchange
    // fails, so this state is transient in both directions.
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center"
        role="status"
        aria-live="polite"
        data-testid="platform-guard-resolving"
      >
        <span className="text-sm text-muted-foreground">Checking platform access…</span>
      </div>
    );
  }

  if (!isEntitled) {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
        role="alert"
        data-testid="platform-access-denied"
      >
        <ShieldAlert className="size-12 text-destructive" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Platform console unavailable</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The platform console is restricted to platform administrators. Your account is signed in
            to a tenant, so this area is not available to it.
          </p>
        </div>
        <Link
          href="/app/dashboard"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to your dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
