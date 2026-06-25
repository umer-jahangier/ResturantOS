"use client";

import { useQuery } from "@tanstack/react-query";

import { FeatureRepository } from "@/lib/repositories/feature.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "./use-current-user";

// Layer-3 hook (D4): the enabled tenant feature flags. Feature flags are NOT in
// the JWT — the gateway enforces them server-side (403 FEATURE_DISABLED); this
// proactively hides UI. Branch-scoped key so a branch switch refetches. The live
// endpoint shape is a Phase-3 contract to confirm (MSW-backed here).
export function useFeatureFlags() {
  const { branchId, isAuthenticated } = useCurrentUser();

  return useQuery({
    queryKey: queryKeys.features.all(branchId),
    queryFn: () => FeatureRepository.getFlags(),
    enabled: isAuthenticated,
    select: (flags) => flags.features,
  });
}
