"use client";

import type { ReactNode } from "react";

import { useFeatureFlags } from "@/lib/hooks/auth/use-feature-flags";

// Renders children only if the required `FEATURE_*` flag is enabled for the
// tenant per `useFeatureFlags()` (FE-06, D4). While the flags are loading we
// render nothing (avoid a flash). This is proactive UI hiding only — the gateway
// still enforces features server-side (403 FEATURE_DISABLED).
interface FeatureGuardProps {
  feature: string;
  fallback?: ReactNode;
  /** When true, render children if the feature-flags API fails (gateway still enforces). */
  failOpenOnError?: boolean;
  children: ReactNode;
}

export function FeatureGuard({
  feature,
  fallback = null,
  failOpenOnError = false,
  children,
}: FeatureGuardProps) {
  const { data: features, isPending, isError } = useFeatureFlags();

  if (isPending) {
    return null;
  }

  if (isError || !features) {
    return <>{failOpenOnError ? children : fallback}</>;
  }

  return <>{features.includes(feature) ? children : fallback}</>;
}
