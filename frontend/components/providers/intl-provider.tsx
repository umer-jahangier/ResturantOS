"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

// Minimal en catalogue — full message catalogues land in a later phase.
const messages = {
  common: {
    appName: "RestaurantOS",
    signIn: "Sign in",
    signOut: "Sign out",
  },
};

export function IntlProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" timeZone="Asia/Karachi" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
