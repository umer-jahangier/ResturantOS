"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type { TenantFeatures } from "@/lib/models/platform.model";

/**
 * A tenant's modules, each carrying where its value came from (19c).
 *
 * The provenance is the point. Before the API exposed `is_override` this hook could only have
 * returned `code → boolean`, and the screen could not have distinguished a module an operator
 * revoked from one the tier never included — which is precisely the distinction that decides what
 * happens on the next tier change.
 */
export function useTenantFeatures(tenantId: string) {
  return useQuery<TenantFeatures>({
    queryKey: platformKeys.features(tenantId),
    queryFn: () => PlatformRepository.getFeatures(tenantId),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

/**
 * Toggle a module for a tenant.
 *
 * <h3>No optimistic update, deliberately</h3>
 *
 * A toggle here changes what a real tenant's staff can reach: the gateway refuses the module's
 * routes with 403 FEATURE_DISABLED on the very next request. Painting the new state before the
 * server confirms it would mean a failed PATCH leaves the operator believing they disabled a
 * module that is still live — a false negative on an access control, which is the worst direction
 * for this particular error to point. The switch stays where it was until the refetch lands.
 *
 * Usage is invalidated alongside features because entitlement and enablement are read together on
 * the tenant detail screen.
 */
export function useSetTenantFeature(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<boolean, Error, { code: string; enabled: boolean }>({
    mutationFn: ({ code, enabled }) => PlatformRepository.setFeature(tenantId, code, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: platformKeys.features(tenantId) });
      void queryClient.invalidateQueries({ queryKey: platformKeys.usage(tenantId) });
    },
  });
}

/**
 * Hand a module back to tier control.
 *
 * The counterpart to the toggle, which marks an override on every call by design. Without this an
 * operator who flipped a switch by mistake has silently pinned that module against every future
 * upgrade and downgrade, with no way back through the UI.
 */
export function useClearFeatureOverride(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<boolean, Error, { code: string }>({
    mutationFn: ({ code }) => PlatformRepository.clearFeatureOverride(tenantId, code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: platformKeys.features(tenantId) });
    },
  });
}
