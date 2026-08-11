"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { UserRepository, type UserListParams } from "@/lib/repositories/user.repository";
import type {
  AssignBranchRolePayload,
  CreateUserPayload,
  UpdateUserPayload,
} from "@/lib/models/user.model";

/**
 * Layer-3 hooks for tenant user administration.
 *
 * <h3>Why these keys are NOT branch-scoped</h3>
 *
 * Every other server-state key in this app embeds `branchId` so a branch switch invalidates
 * cleanly. A user belongs to the TENANT, not to a branch — `GET /api/v1/users` returns the tenant's
 * whole roster and its rows carry per-branch assignments as data. Scoping the cache by branch would
 * refetch the same list on every switch and, worse, imply a per-branch roster that does not exist.
 * The CRM keys are unscoped for the same reason and say so.
 *
 * <h3>Why the keys are local rather than in `query-keys.ts`</h3>
 *
 * The shared registry is edited by every concurrent workstream at once; adding a namespace to it
 * here would be a merge conflict on a file this plan has no other reason to touch. The precedent is
 * already in the tree (`use-inventory.ts` keeps its own key arrays for exactly this reason, and the
 * registry's own comment records it). Folding these in is a one-line migration whenever the file is
 * next open for another purpose.
 */
export const userKeys = {
  all: () => ["users"] as const,
  list: (params: UserListParams) => ["users", "list", params] as const,
  detail: (userId: string) => ["users", "detail", userId] as const,
  assignableRoles: () => ["users", "assignable-roles"] as const,
};

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => UserRepository.list(params),
    // A roster changes when an admin changes it, and this screen invalidates on every write.
    staleTime: 30_000,
    // The list keeps its previous page on screen while the next one loads, so paging and typing
    // do not flash the skeleton over a table the user is reading.
    placeholderData: (previous) => previous,
  });
}

export function useUserDetail(userId: string | null) {
  return useQuery({
    queryKey: userKeys.detail(userId ?? ""),
    queryFn: () => UserRepository.get(userId as string),
    enabled: Boolean(userId),
  });
}

/**
 * The ceiling-filtered role catalogue.
 *
 * <p>`enabled` exists so a screen can decline to ask when the caller holds neither administration
 * authority: `GET /api/v1/roles` answers 403 for them (measured — a MANAGER gets 403), and a
 * guaranteed 403 rendered as a retryable error is noise, not information.
 */
export function useAssignableRoles(enabled = true) {
  return useQuery({
    queryKey: userKeys.assignableRoles(),
    queryFn: () => UserRepository.listAssignableRoles(),
    enabled,
    // The catalogue changes only when the RBAC seed changes.
    staleTime: 5 * 60_000,
  });
}

/**
 * Every write invalidates the whole `["users"]` prefix rather than patching the cache by hand.
 *
 * <p>Deliberate: a role assignment can DISPLACE another role (one active role per branch), a
 * deactivation revokes sessions, and a create may or may not have produced a loginable account.
 * Reconstructing all of that client-side is how a list ends up showing a state the server never
 * had. One refetch is cheap and cannot be wrong.
 */
function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: userKeys.all() });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) => UserRepository.create(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: UpdateUserPayload }) =>
      UserRepository.update(userId, payload),
    onSuccess: invalidate,
  });
}

export function useDeactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (userId: string) => UserRepository.deactivate(userId),
    onSuccess: invalidate,
  });
}

export function useReactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (userId: string) => UserRepository.reactivate(userId),
    onSuccess: invalidate,
  });
}

/**
 * Administrator-initiated reset.
 *
 * <p>The result carries a temporary password that exists exactly once. It is returned from the
 * mutation and never written to the query cache: a cache entry is persisted, inspectable through
 * devtools and re-readable by any later render, and a one-time credential should outlive its dialog
 * by nothing at all.
 */
export function useAdminResetPassword() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      UserRepository.resetPassword(userId, reason),
    onSuccess: invalidate,
  });
}

export function useAssignBranchRole() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: AssignBranchRolePayload }) =>
      UserRepository.assignBranchRole(userId, payload),
    onSuccess: invalidate,
  });
}

export type { UserListParams };
