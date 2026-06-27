"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSessionStore, refreshSession } from "@/lib/auth/session";

interface BootstrapContextValue {
  isBootstrapping: boolean;
}

const BootstrapContext = createContext<BootstrapContextValue>({
  isBootstrapping: false,
});

/** Returns true while the session is being rehydrated from the refresh-token cookie on page load. */
export function useBootstrapping(): BootstrapContextValue {
  return useContext(BootstrapContext);
}

/**
 * Eagerly rehydrates the in-memory session from the HttpOnly `refresh_token` cookie on
 * every full page load. This is the real client-side auth gate — proxy.ts only reads the
 * UX-hint `has_session` cookie and can be bypassed by anyone who sets that cookie manually.
 * The bootstrap here calls POST /api/v1/auth/refresh, which requires a valid HttpOnly
 * refresh token; a forged `has_session` cookie will fail this step and redirect to /login.
 *
 * Security chain:
 *   1. proxy.ts  — fast first-pass redirect for browsers with no cookie at all
 *   2. SessionProvider (here) — validates by actually calling the auth-service refresh endpoint
 *   3. Gateway — enforces every API call via Bearer token; 401 → another refresh attempt
 *
 * Must be mounted inside QueryProvider (refreshSession uses axios which needs the client).
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // If the store already has a session (e.g. login was just completed in this tab)
    // there is nothing to rehydrate.
    if (useSessionStore.getState().session !== null) return;

    // Read the UX-hint cookie synchronously. If it is absent we are definitely logged
    // out — no refresh call needed.
    const hasSessionCookie = document.cookie
      .split(";")
      .some((c) => c.trim().startsWith("has_session="));
    if (!hasSessionCookie) return;

    // has_session present but no in-memory token → page was reloaded (or cookie was forged).
    // Attempt to exchange the HttpOnly refresh token for a new access token.
    let cancelled = false;
    setIsBootstrapping(true);

    void refreshSession().then((succeeded) => {
      if (cancelled) return;
      setIsBootstrapping(false);

      if (!succeeded) {
        // The refresh token is expired, revoked, or the cookie was forged.
        // Clear the stale UX marker and send the user to login.
        // Guard against a redirect loop when already on a public auth route.
        const isPublicRoute =
          pathname.startsWith("/login") || pathname.startsWith("/auth");
        if (!isPublicRoute) {
          router.replace("/login?reason=session_expired");
        }
      }
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-once — bootstrap runs once per page load

  return (
    <BootstrapContext.Provider value={{ isBootstrapping }}>
      {children}
    </BootstrapContext.Provider>
  );
}
