"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { usePlatformSession } from "@/lib/hooks/use-platform-session";

/**
 * False during the server render AND React's hydration pass; true on every render after.
 *
 * The `useSyncExternalStore` form rather than the usual `useState(false)` + `useEffect(() => set(true))`:
 * it produces the same result with no state update in an effect (which this codebase's lint rules
 * reject as a cascading render, and rightly — it costs an extra commit on every mount).
 *
 * The subscribe function never notifies because the value it reports cannot change: "are we past
 * hydration" transitions exactly once, and React re-reads the client snapshot on its own after
 * hydrating.
 */
const NEVER_CHANGES = () => () => {};
function useMounted(): boolean {
  return React.useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );
}

/**
 * Is the forgeable UX-hint cookie present?
 *
 * Used ONLY to tell "the refresh has not started yet" from "the refresh finished and there is no
 * session" — never to decide entitlement. That distinction is the whole of GA-002: this cookie is
 * set for every logged-in user of every tenant and grants nothing.
 */
function hasSessionMarker(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("has_session="));
}

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
  const mounted = useMounted();

  // Not decided yet. Three distinct reasons, all of which must render the SAME neutral wait:
  //
  //   · `!mounted` — the server render and React's hydration pass. There is no session on the
  //     server, so branching on entitlement here would emit "access denied" into the HTML and then
  //     replace it on the client. That is a hydration mismatch, and this component had one: an
  //     earlier version tested `typeof window !== "undefined"` in the render body, which is the
  //     first bullet in React's own list of causes. The browser E2E observability guard caught it.
  //   · `isResolving` — the refresh-token exchange is in flight.
  //   · a marker cookie but NO SESSION YET — the frame between hydration and `SessionProvider`'s
  //     effect starting the exchange. Without this a legitimate SuperAdmin sees a flash of
  //     "Platform console unavailable" on every hard refresh.
  //
  // The third condition tests `!isAuthenticated`, deliberately not `!isEntitled`. A tenant user
  // IS authenticated and never becomes entitled, so waiting on entitlement would leave them on a
  // spinner forever instead of telling them the truth.
  //
  // `hasSessionMarker` is read only once `mounted` is true, so it never runs during SSR or
  // hydration and cannot reintroduce the mismatch it helps avoid.
  if (!mounted || isResolving || (!isAuthenticated && hasSessionMarker())) {
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
          className="rounded-md bg-primary-solid px-4 py-2 text-sm font-medium text-primary-solid-foreground"
        >
          Back to your dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
