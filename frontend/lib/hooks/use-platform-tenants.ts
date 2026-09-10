"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import type {
  ChangeTierBody,
  CreateTenantBody,
  PlatformTenant,
  ProvisionResult,
  RetryProvisioningBody,
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
  tenantUsers: (tenantId: string) => ["platform", "tenants", tenantId, "users"] as const,
  subscription: (tenantId: string) => ["platform", "tenants", tenantId, "subscription"] as const,
  subscriptionLimits: (tenantId: string) =>
    ["platform", "tenants", tenantId, "subscription", "limits"] as const,
  subscriptionHistory: (tenantId: string, page: number) =>
    ["platform", "tenants", tenantId, "subscription", "history", page] as const,
  operatorAudit: (tenantId: string | undefined, page: number) =>
    ["platform", "operator-audit", tenantId ?? "all", page] as const,
  /** The plan catalogue. Keyed on `includeInactive` because it is a different list, not a filter. */
  plans: (includeInactive: boolean) => ["platform", "plans", includeInactive] as const,
  /**
   * The cross-tenant register.
   *
   * The whole filter object is part of the key because every one of those filters is applied
   * SERVER-side — `status`, `planCode`, `trialEndingBefore`, `renewingBefore` and the page index all
   * change which rows come back. Keying on the page alone would serve one filter's rows under
   * another filter's heading, which on a register is the console showing the wrong restaurants.
   */
  subscriptions: (filters: Record<string, string | number | undefined>) =>
    ["platform", "subscriptions", filters] as const,
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

/**
 * Take a cancelled tenant out of service permanently.
 *
 * Nothing is deleted — the endpoint sets a status column and returns the tenant. The mutation is
 * still treated as the heaviest one on this console, because the STATE it moves to is the one
 * nothing in the product moves back out of: there is no un-close endpoint, and `reactivate` refuses
 * a PURGED tenant. The confirmation, not the API, is what makes that legible.
 */
export function useCloseTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<PlatformTenant, Error, void>({
    mutationFn: () => PlatformRepository.closeTenant(tenantId),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

/**
 * Re-drive a failed provisioning saga on the same tenant row.
 *
 * The response carries a NEW one-time temporary password, so the caller must render it once and
 * say plainly that it will not be shown again — notification-service has no source files, so no
 * email carries it and the operator is the delivery channel.
 */
export function useRetryProvisioning(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProvisionResult, Error, RetryProvisioningBody>({
    mutationFn: (body) => PlatformRepository.retryProvisioning(tenantId, body),
    onSuccess: () => invalidateTenant(queryClient, tenantId),
  });
}

function invalidateTenant(queryClient: ReturnType<typeof useQueryClient>, tenantId: string): void {
  void queryClient.invalidateQueries({ queryKey: platformKeys.tenants() });
  void queryClient.invalidateQueries({ queryKey: platformKeys.tenant(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.features(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.usage(tenantId) });
  // A lifecycle transition writes an operator-audit row and can move the subscription's standing
  // with it, so the panels that read those are stale the moment one lands. Invalidating them here
  // rather than at each call site is what stops the activity feed showing an operator's own action
  // as absent for thirty seconds after they performed it.
  void queryClient.invalidateQueries({ queryKey: platformKeys.subscription(tenantId) });
  void queryClient.invalidateQueries({ queryKey: platformKeys.subscriptionLimits(tenantId) });
  void queryClient.invalidateQueries({ queryKey: ["platform", "operator-audit"] });
}
