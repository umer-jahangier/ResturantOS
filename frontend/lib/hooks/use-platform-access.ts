"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PlatformAccessRepository } from "@/lib/repositories/platform-access.repository";
import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type { OperatorAuditPage, TenantUserPage } from "@/lib/models/platform.model";
import type {
  AdminPasswordReset,
  PlatformUserDetail,
  UserSecurityState,
} from "@/lib/models/platform-access.model";

/**
 * The prefix every page of the operator trail sits under.
 *
 * <p>DERIVED from the key builder that owns it rather than restated as a literal. The trail is
 * declared in `use-platform-tenants.ts` and is read by a component in this feature, so the two
 * files have to agree about its prefix — and a second hand-written `["platform","operator-audit"]`
 * is a string that can be typo'd into an invalidation which silently never matches. A stale audit
 * panel after an audited action is precisely the failure an operator would not notice.
 */
const OPERATOR_AUDIT_ROOT = platformKeys.operatorAudit(undefined, 0).slice(0, 2);

/**
 * Layer-3 hooks for the platform tier's people surfaces — the fleet directory, one user, and the
 * five audited actions an operator can take on that user.
 *
 * <h3>Why the keys are declared here and not in `lib/hooks/query-keys.ts`</h3>
 *
 * The shared registry is branch-scoped by construction: every key embeds a `branchId` so that a
 * branch switch invalidates cleanly. A platform session has no branch AND no tenant — both claims
 * are absent from a control-plane token, which is the whole reason the gateway maintains
 * `TENANT_OPTIONAL_PATHS`. Threading a `""` branch through that registry to satisfy its shape
 * would be a lie in the one place the codebase uses to reason about scope. Same decision, same
 * reason, as `platformKeys` in `use-platform-tenants.ts`.
 */
export const platformAccessKeys = {
  /** The fleet fan-out. The whole filter set is in the key: each combination is a different scan. */
  fleetUsers: (filters: FleetUserFilters) =>
    [
      "platform",
      "fleet-users",
      filters.tenantId ?? "",
      filters.tenantStatus ?? "",
      filters.status ?? "",
      filters.roleCode ?? "",
      filters.search ?? "",
      filters.page,
    ] as const,
  user: (tenantId: string, userId: string) =>
    ["platform", "tenants", tenantId, "users", userId] as const,
  /**
   * The operator trail for ONE person, filtered fleet-wide by their user id.
   *
   * <p>Built on `OPERATOR_AUDIT_ROOT` so that a lifecycle mutation's invalidation — which targets
   * that prefix — reaches this panel too. A key under a prefix of its own would leave the trail
   * showing the state before the action that wrote to it.
   */
  userAudit: (userId: string, page: number) =>
    [...OPERATOR_AUDIT_ROOT, "target-user", userId, page] as const,
  permissions: () => ["platform", "rbac", "permissions"] as const,
  matrix: (tenantId: string | undefined) =>
    ["platform", "rbac", "matrix", tenantId ?? "global"] as const,
};

export interface FleetUserFilters {
  tenantId?: string;
  tenantStatus?: string;
  status?: string;
  roleCode?: string;
  search?: string;
  page: number;
}

/**
 * Every user across every tenant.
 *
 * <h3>What this query costs, stated because it is real</h3>
 *
 * There is no cross-tenant user query in this product. One HTTP call goes out per tenant that
 * matches the filter, capped at 100, and the answer carries a `scan` block saying how many were
 * made and which failed. Narrowing by tenant or by tenant status is not a convenience — it removes
 * calls, and it is the only way to get a total the API is willing to state.
 *
 * <p>`retry: false`: a 403 here means the principal is not a SuperAdmin, and retrying an
 * authorization refusal three times only hides the honest answer behind a spinner. A fan-out
 * failure is not retried either — the partial answer already names what it missed, and a silent
 * re-run would replace a stated incompleteness with a different one.
 *
 * <p>`placeholderData` keeps the previous page's rows on screen while the next one is fetched, so
 * paging does not blank a grid an operator is reading. The `scan` block travels with the data, so
 * a stale page's provenance is never shown beside fresh rows.
 */
export function useFleetUsers(filters: FleetUserFilters, enabled = true) {
  return useQuery<TenantUserPage>({
    queryKey: platformAccessKeys.fleetUsers(filters),
    queryFn: () =>
      PlatformAccessRepository.listFleetUsers({
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.tenantStatus ? { tenantStatus: filters.tenantStatus } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.roleCode ? { roleCode: filters.roleCode } : {}),
        ...(filters.search?.trim() ? { search: filters.search.trim() } : {}),
        page: filters.page,
        size: 50,
      }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/** One user, read through the tenant-scoped endpoint — a single call, never a fan-out. */
export function usePlatformUser(tenantId: string, userId: string) {
  return useQuery<PlatformUserDetail>({
    queryKey: platformAccessKeys.user(tenantId, userId),
    queryFn: () => PlatformAccessRepository.getUser(tenantId, userId),
    enabled: Boolean(tenantId) && Boolean(userId),
    retry: false,
  });
}

/**
 * What every lifecycle mutation invalidates, in one place.
 *
 * <p>Three things go stale on a successful action and all three are on screen at once: the user's
 * own detail, the fleet directory that lists them, and the operator trail the action just wrote a
 * row to. The trail is the one that matters most — an audited action whose audit panel still shows
 * the previous state is a console quietly telling an operator their action was not recorded.
 */
function useLifecycleInvalidation(tenantId: string, userId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: platformAccessKeys.user(tenantId, userId) });
    void queryClient.invalidateQueries({ queryKey: ["platform", "fleet-users"] });
    void queryClient.invalidateQueries({ queryKey: platformKeys.tenantUsers(tenantId) });
    void queryClient.invalidateQueries({ queryKey: OPERATOR_AUDIT_ROOT });
  };
}

export function useDeactivateUser(tenantId: string, userId: string) {
  const invalidate = useLifecycleInvalidation(tenantId, userId);
  return useMutation<void, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformAccessRepository.deactivate(tenantId, userId, reason),
    onSuccess: invalidate,
  });
}

export function useReactivateUser(tenantId: string, userId: string) {
  const invalidate = useLifecycleInvalidation(tenantId, userId);
  return useMutation<void, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformAccessRepository.reactivate(tenantId, userId, reason),
    onSuccess: invalidate,
  });
}

export function useUnlockUser(tenantId: string, userId: string) {
  const invalidate = useLifecycleInvalidation(tenantId, userId);
  return useMutation<UserSecurityState, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformAccessRepository.unlock(tenantId, userId, reason),
    onSuccess: invalidate,
  });
}

export function useRevokeUserSessions(tenantId: string, userId: string) {
  const invalidate = useLifecycleInvalidation(tenantId, userId);
  return useMutation<UserSecurityState, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformAccessRepository.revokeSessions(tenantId, userId, reason),
    onSuccess: invalidate,
  });
}

/**
 * Mint a temporary password.
 *
 * <p>The result is the ONLY copy of that credential in existence. The caller holds it in component
 * state and shows it outside the dialog, because a dialog that closes on success would take the
 * password with it and leave a tenant unreachable — the same mistake the retry-provisioning panel
 * was built to avoid.
 */
export function useResetUserPassword(tenantId: string, userId: string) {
  const invalidate = useLifecycleInvalidation(tenantId, userId);
  return useMutation<AdminPasswordReset, Error, { reason: string }>({
    mutationFn: ({ reason }) => PlatformAccessRepository.resetPassword(tenantId, userId, reason),
    onSuccess: invalidate,
  });
}

/**
 * Every platform-tier action taken against ONE person, newest first.
 *
 * <h3>Why this is filtered by target user and by nothing else</h3>
 *
 * The endpoint applies its filters in PRIORITY order — operator, then tenant, then target user —
 * rather than combining them. That is a real limitation of the reader and it decides the call:
 * passing a tenant alongside the user id would silently answer the tenant question instead, so
 * this passes the user id alone and the panel is honest about what it shows — everything done to
 * this person, wherever it was done from.
 *
 * <h3>Why an accountability trail ships with a reader at all</h3>
 *
 * `impersonation_log` is the cautionary example in this same database: the write side worked for
 * an entire milestone with no read path — the repository finder had zero callers and no controller
 * exposed it — so the record of platform staff entering tenant data could only be read from a psql
 * session. An accountability record nobody can read is only marginally better than one that is not
 * written.
 *
 * <p>Both successes AND refusals come back. An operator repeatedly attempting something they are
 * refused is exactly the pattern an abuse review looks for, and a feed of successes cannot show it.
 * The rows are append-only at the trigger layer, so this reader cannot be shown a rewritten
 * history — which is the property that makes reading it worth anything.
 */
export function useUserOperatorAudit(userId: string, page: number) {
  return useQuery<OperatorAuditPage>({
    queryKey: platformAccessKeys.userAudit(userId, page),
    queryFn: () => PlatformRepository.listOperatorAudit({ targetUserId: userId, page }),
    enabled: Boolean(userId),
    retry: false,
  });
}
