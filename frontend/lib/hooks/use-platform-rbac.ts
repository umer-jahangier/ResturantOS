"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformAccessRepository } from "@/lib/repositories/platform-access.repository";
import { platformAccessKeys } from "@/lib/hooks/use-platform-access";
import type { PermissionMatrix, PermissionModule } from "@/lib/models/platform-access.model";

/**
 * The platform tier's view of the authorization model — three reads, and no writes anywhere.
 *
 * <h3>There is no mutation hook in this file, and there must not be one</h3>
 *
 * Composing a role IS granting authority. At the tenant tier that is bounded by the role ceiling:
 * an assigner may only grant a role whose permissions are a subset of their own, recomputed from
 * the database on every call. A platform operator holds no `user_branch_roles`, so the ceiling
 * resolves the empty set against them — there is nothing to bound a platform-tier role editor
 * with, and one would hand back the exact escalation that splitting `rbac.manage` out of
 * `rbac.role.manage` was done to prevent.
 *
 * <p>The API carries that reason in every response as `readOnlyReason`, and the screen renders it.
 * It is a posture, not an error state. Tenant custom roles stay editable by that tenant's own
 * administrators through the tenant-tier role API, which keeps its ceiling; system roles are
 * seeded by Liquibase and are editable by nobody at any tier.
 *
 * <h3>Both queries are long-lived on purpose</h3>
 *
 * The permission vocabulary changes when a Liquibase changeset ships, and the matrix changes when
 * a tenant edits one of its own custom roles. Neither happens while an operator has the screen
 * open, and re-fetching 79 permissions plus a 711-cell grid on every window focus is a cost with
 * no reader. `staleTime` is set accordingly rather than the grid being memoised around a default
 * that fights it.
 */
export function usePlatformPermissions() {
  return useQuery<PermissionModule[]>({
    queryKey: platformAccessKeys.permissions(),
    queryFn: () => PlatformAccessRepository.listPermissionModules(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * The role × permission grid, globally or for one tenant.
 *
 * <p>`tenantId` undefined is the GLOBAL catalogue: the system roles every tenant inherits, with
 * holder counts of 0 because holders are a per-tenant fact and a fleet-wide sum is a number nobody
 * asked for. Named, it adds that tenant's own custom roles and fills the counts in. The scope
 * travels in the response and the screen states which one it is showing — "9 roles" means
 * different things in the two cases.
 */
export function usePermissionMatrix(tenantId: string | undefined) {
  return useQuery<PermissionMatrix>({
    queryKey: platformAccessKeys.matrix(tenantId),
    queryFn: () => PlatformAccessRepository.getPermissionMatrix(tenantId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
