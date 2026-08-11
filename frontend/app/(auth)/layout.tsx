import type { ReactNode } from "react";

import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * Public auth area (login, password reset, TOTP). No session required.
 *
 * ZONE: expressive (D-34-02). Login is a first-impression screen with no operator
 * under time pressure on it, so it carries the full surface and motion vocabulary.
 * It is also the only expressive surface reachable without a session, which is why
 * plan 34-07 measures its glass contrast against a declared substrate rather than
 * against whatever the page happens to paint.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ZoneProvider zone="expressive">
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </ZoneProvider>
  );
}
