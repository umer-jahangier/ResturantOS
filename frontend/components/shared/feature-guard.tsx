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
  children: ReactNode;
}

export function FeatureGuard({ feature, fallback = null, children }: FeatureGuardProps) {
  const { data: features, isPending, isError } = useFeatureFlags();

  if (isPending) {
    return null;
  }

  if (isError || !features) {
    return <>{fallback}</>;
  }

  return <>{features.includes(feature) ? children : fallback}</>;
}
