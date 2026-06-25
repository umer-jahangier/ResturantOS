"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";
import { IntlProvider } from "./intl-provider";

// Composes every client-side provider for the app shell.
// The MSW provider is wired in here in plan 04-01 Task 3.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <IntlProvider>
        <QueryProvider>
          {children}
          <Toaster richColors position="top-right" />
        </QueryProvider>
      </IntlProvider>
    </ThemeProvider>
  );
}
