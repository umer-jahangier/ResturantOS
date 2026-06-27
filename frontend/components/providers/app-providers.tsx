"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { StatusAnnouncer } from "@/components/ui/status-announcer";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";
import { IntlProvider } from "./intl-provider";

// Composes every client-side provider for the app shell. All API traffic goes
// to the live gateway (NEXT_PUBLIC_API_BASE_URL) — there is no runtime mocking.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <IntlProvider>
        <QueryProvider>
          {children}
          <StatusAnnouncer />
          <Toaster richColors position="bottom-right" />
        </QueryProvider>
      </IntlProvider>
    </ThemeProvider>
  );
}
