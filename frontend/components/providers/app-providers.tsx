"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { StatusAnnouncer } from "@/components/ui/status-announcer";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";
import { IntlProvider } from "./intl-provider";
import { SessionProvider } from "./session-provider";

// Composes every client-side provider for the app shell. All API traffic goes
// to the live gateway (NEXT_PUBLIC_API_BASE_URL) — there is no runtime mocking.
//
// Provider order matters:
//   ThemeProvider / IntlProvider — no network; can wrap everything
//   QueryProvider — creates the QueryClient that SessionProvider's refresh call uses
//   SessionProvider — must be inside QueryProvider; bootstraps the in-memory session
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <IntlProvider>
        <QueryProvider>
          <SessionProvider>
            {children}
            <StatusAnnouncer />
            <Toaster richColors position="bottom-right" />
          </SessionProvider>
        </QueryProvider>
      </IntlProvider>
    </ThemeProvider>
  );
}
