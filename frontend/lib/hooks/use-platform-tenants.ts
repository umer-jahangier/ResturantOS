"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import type {
  ChangeTierBody,
  CreateTenantBody,
  PlatformTenant,
  ProvisionResult,
  TierChangeResult,
  UpdateTenantBody,
} from "@/lib/models/platform.model";

/**
 * Layer-3 hooks for the SuperAdmin tenant plane (19c).
 *
 * <h3>Why the query keys live here rather than in `lib/hooks/query-keys.ts`</h3>
 *
 * The shared registry is branch-scoped by construction — every key embeds a `branchId` so a branch
 * switch invalidates cleanly. A platform session has **no branch and no tenant**: `tenantId` and
 * `branchId` are null on a platform token, which is the whole reason the gateway maintains
 * `TENANT_OPTIONAL_PATHS`. Threading a `""` branch through that registry to satisfy its shape
 * would be a lie in the one place the codebase uses to reason about scope.
 *
 * These keys are deliberately NOT branch-scoped and are declared beside their only consumers.
 */
export const platformKeys = {
  all: () => ["platform"] as const,
  tenants: () => ["platform", "tenants"] as const,
  tenant: (tenantId: string) => ["platform", "tenants", tenantId] as const,
  features: (tenantId: string) => ["platform", "tenants", tenantId, "features"] as const,
  usage: (tenantId: string) => ["platform", "tenants", tenantId, "usage"] as const,
};

/**
 * Every tenant on the platform.
 *
 * `retry: false` is deliberate. A 403 here means the principal is not a SuperAdmin, and retrying
 * an authorization refusal three times only delays the honest error by a few seconds while the
 * screen shows a spinner that implies something is loading.
 */
export function usePlatformTenants() {
  return useQuery({
    queryKey: platformKeys.tenants(),
    queryFn: () => PlatformRepository.listTenants(),
    retry: false,
  });
}

export function usePlatformTenant(tenantId: string) {
  return useQuery({
    queryKey: platformKeys.tenant(tenantId),
    queryFn: () => PlatformRepository.getTenant(tenantId),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation<ProvisionResult, Error, CreateTenantBody>({
    mutationFn: (body) => PlatformRepository.createTenant(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: platformKeys.tenants() });
    },
  });
}

export function useUpdateTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlatformTenant, Error, UpdateTenantBody>({
    mutationFn: (body) => PlatformRepository.updateTenant(tenantId, body),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

/**
 * Change a tenant's tier.
 *
 * Invalidates features and usage as well as the tenant row, because a tier change moves all three:
 * it reconciles feature rows against the new tier's defaults (skipping overrides) and re-stamps
 * every entitlement ceiling. Refetching only the tenant would leave the features table showing
 * defaults computed against the previous tier — the exact staleness the `tier` field on the
 * features response exists to make detectable.
 */
export function useChangeTier(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<TierChangeResult, Error, ChangeTierBody>({
    mutationFn: (body) => PlatformRepository.changeTier(tenantId, body),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

export function useSuspendTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlatformTenant, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformRepository.suspendTenant(tenantId, reason),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

export function useReactivateTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlatformTenant, Error, void>({
    mutationFn: () => PlatformRepository.reactivateTenant(tenantId),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

export function useCancelTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlatformTenant, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformRepository.cancelTenant(tenantId, reason),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

function invalidateTenant(queryClient: ReturnType<typeof useQueryClient>, tenantId: string): void {
  void queryClient.invalidateQueries({ queryKey: platformKeys.tenants() });
  void queryClient.invalidateQueries({ queryKey: platformKeys.tenant(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.features(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.usage(tenantId) });
}
