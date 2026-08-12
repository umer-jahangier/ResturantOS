"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RoleRepository } from "@/lib/repositories/role.repository";
import type { RoleWritePayload } from "@/lib/models/role.model";

/**
 * Layer-3 hooks for the role builder (S3).
 *
 * <p>The role LIST hook is {@code useAssignableRoles()} in `use-roles`' sibling `use-users.ts`, and
 * stays there: it wraps the same `GET /api/v1/roles` the assign dialog reads, and two hooks over
 * one endpoint is two caches that drift. What is here is the permission vocabulary and the writes.
 *
 * <h3>Why the keys are local rather than in `query-keys.ts`</h3>
 *
 * <p>Same reason `use-users.ts` and `use-inventory.ts` record: the shared registry is edited by
 * every concurrent workstream at once and adding a namespace to it here would be a merge conflict
 * on a file this plan has no other reason to touch.
 *
 * <h3>Why every write invalidates the whole `["users"]` prefix too</h3>
 *
 * <p>A role's grants decide what its holders may do, and the users screen renders the role each
 * person holds. Editing a role therefore changes a fact the user list is displaying. One refetch is
 * cheap and cannot be wrong; reconstructing it client-side is how a list ends up showing a state
 * the server never had.
 */
export const roleKeys = {
  all: () => ["roles"] as const,
  permissions: () => ["roles", "permission-catalogue"] as const,
};

/**
 * The permission vocabulary, grouped by module.
 *
 * <p>`enabled` exists so a screen can decline to ask when the caller holds neither administration
 * code: the endpoint answers 403 for them, and a guaranteed 403 rendered as a retryable error is
 * noise rather than information.
 *
 * <p>Long `staleTime`: this list changes when the PLATFORM ships a new permission, not when a
 * tenant does anything. Refetching it per mount would be a request that can only ever return the
 * same 76 codes.
 */
export function usePermissionCatalogue(enabled = true) {
  return useQuery({
    queryKey: roleKeys.permissions(),
    queryFn: () => RoleRepository.listPermissions(),
    enabled,
    staleTime: 30 * 60_000,
  });
}

function useInvalidateRoles() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: roleKeys.all() });
    // `useAssignableRoles` caches under ["users","assignable-roles"] — the list this screen reads.
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  };
}

export function useCreateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (payload: RoleWritePayload) => RoleRepository.create(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ roleCode, payload }: { roleCode: string; payload: RoleWritePayload }) =>
      RoleRepository.update(roleCode, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (roleCode: string) => RoleRepository.remove(roleCode),
    onSuccess: invalidate,
  });
}
