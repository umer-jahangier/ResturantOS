"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { MswProvider } from "./msw-provider";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";
import { IntlProvider } from "./intl-provider";

// Composes every client-side provider for the app shell. MswProvider is a
// transparent passthrough unless NEXT_PUBLIC_ENABLE_MSW === "true" (dev/test).
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <IntlProvider>
        <MswProvider>
          <QueryProvider>
            {children}
            <Toaster richColors position="top-right" />
          </QueryProvider>
        </MswProvider>
      </IntlProvider>
    </ThemeProvider>
  );
}
