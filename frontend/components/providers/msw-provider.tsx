"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isMswEnabled } from "@/lib/env";

// Starts the MSW browser worker before rendering children — but ONLY when
// NEXT_PUBLIC_ENABLE_MSW === "true" (and never in a production build). When
// disabled it is a transparent passthrough.
export function MswProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isMswEnabled());

  useEffect(() => {
    if (!isMswEnabled()) return;

    let active = true;
    void import("@/mocks/browser").then(async ({ worker }) => {
      await worker.start({ onUnhandledRequest: "bypass" });
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!ready) return null;

  return <>{children}</>;
}
