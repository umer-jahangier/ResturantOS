"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { UserRepository, type UserListParams } from "@/lib/repositories/user.repository";
import { formatUserFacingError } from "@/lib/errors";
import type {
  AssignBranchRolePayload,
  CreateUserPayload,
  ReplaceMenuCategoriesPayload,
  ReplaceStationAssignmentPayload,
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
  /** 28-11. A CHILD of `detail` so invalidating the detail refreshes the scope with it. */
  stations: (userId: string) => ["users", "detail", userId, "stations"] as const,
  /** Program A. A child of `detail` for the same reason `stations` is. */
  menuCategories: (userId: string) => ["users", "detail", userId, "menu-categories"] as const,
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

/**
 * Take one branch-role back (S2).
 *
 * <p>The counterpart to {@link useAssignBranchRole}, and until now the missing half of the pair:
 * the endpoint has worked since 13-02 and no screen ever called it, so a grant was permanent and a
 * promoted, demoted or transferred employee kept their old branch access for good.
 *
 * <p>It invalidates the whole `["users"]` prefix for the same reason every other write here does,
 * and that matters more on this one than most: revoking a user's LAST active assignment leaves an
 * account that cannot sign in at all, which the detail panel renders as a named state rather than
 * an empty list. Patching the cache by hand is how the panel would end up showing a roster the
 * server never had.
 *
 * <p><b>The revoked user's own session does not end here.</b> Their permissions are carried in an
 * access token they already hold; the change lands when that token is next refreshed. Any screen
 * calling this has to say so, exactly as the approval-limit form does — the difference between an
 * owner who waits and an owner who concludes the button does nothing.
 */
export function useRevokeBranchRole() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({
      userId,
      branchId,
      roleCode,
    }: {
      userId: string;
      branchId: string;
      roleCode: string;
    }) => UserRepository.removeBranchRole(userId, { branchId, roleCode }),
    onSuccess: invalidate,
  });
}

/**
 * A user's station scope (28-11).
 *
 * <p>`enabled` is driven by the userId alone rather than by a permission check: the read is gated
 * on `rbac.user.manage` server-side and the two surfaces that call this — the user form and the
 * detail panel — are already behind that authority.
 */
export function useUserStations(userId: string | null) {
  return useQuery({
    queryKey: userKeys.stations(userId ?? ""),
    queryFn: () => UserRepository.getStationAssignments(userId as string),
    enabled: Boolean(userId),
  });
}

/**
 * Replace one branch's station set.
 *
 * <p>Invalidates the whole `["users"]` prefix — which covers `userKeys.stations` and
 * `userKeys.detail` both — for the same reason every other write here does: reconstructing the
 * result client-side is how a panel ends up showing a state the server never had. The scope is
 * also carried in the target user's ACCESS TOKEN, so the panel refreshing is the only part of
 * this that is immediate; their own session picks the change up on its next refresh.
 */
export function useReplaceUserStations() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string;
      payload: ReplaceStationAssignmentPayload;
    }) => UserRepository.replaceStationAssignments(userId, payload),
    onSuccess: invalidate,
  });
}

/**
 * A user's menu-category scope (Program A) — which sections of the menu they may ring.
 *
 * <p>`enabled` is driven by the userId alone, as `useUserStations` is and for the same reason: the
 * read is gated on `rbac.user.manage` server-side and both surfaces that call it are already
 * behind that authority.
 */
export function useUserMenuCategories(userId: string | null) {
  return useQuery({
    queryKey: userKeys.menuCategories(userId ?? ""),
    queryFn: () => UserRepository.getMenuCategoryAssignments(userId as string),
    enabled: Boolean(userId),
  });
}

/**
 * Replace one branch's category set.
 *
 * <p>Invalidates the whole `["users"]` prefix — covering `userKeys.menuCategories` and
 * `userKeys.detail` both — for the reason every other write here does.
 *
 * <p><b>Only the admin's own panel is immediate.</b> The scope rides `attributes.menu_categories`
 * on the TARGET user's access token, which lives 900 seconds; a cashier already signed in keeps
 * their current menu until their session refreshes. Any screen calling this has to say so, or an
 * owner concludes the save did nothing and does it three more times.
 */
export function useReplaceUserMenuCategories() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: ReplaceMenuCategoriesPayload }) =>
      UserRepository.replaceMenuCategoryAssignments(userId, payload),
    onSuccess: invalidate,
  });
}

/** One holder's outcome from the bulk apply. `error` is already user-facing. */
export interface ApprovalLimitApplyOutcome {
  userId: string;
  email: string;
  ok: boolean;
  error?: string;
}

/**
 * Apply one approval limit to every current holder of a role at a branch.
 *
 * <h3>Why this is a loop and not an endpoint</h3>
 *
 * Every write goes through `UserRepository.assignBranchRole` — the SAME call a single assignment
 * makes, hitting the same endpoint, passing the same server-side role-ceiling check. A bulk
 * endpoint would be a second write path for one field, and a second write path is how two paths
 * drift; worse, the ceiling check that stops an admin granting above their own level lives on the
 * single-assignment path, so a bulk endpoint would have to re-implement it or skip it.
 *
 * <h3>Why every failure is reported by name</h3>
 *
 * A holder the caller may not assign that role to is refused server-side with
 * `ROLE_CEILING_EXCEEDED` and writes nothing. Dropping that silently would tell an owner "limits
 * applied" while some of their managers still could not approve anything — the precise shape of
 * "structurally present, behaviourally absent" this phase exists to end. Each holder is therefore
 * attempted independently and its outcome returned, and one refusal does not abort the rest.
 *
 * <h3>Why the holders are discovered client-side</h3>
 *
 * The roster endpoint returns users without their assignments, so membership of "holds ROLE at
 * BRANCH" is read from each user's detail. It is N+1 calls against a roster the server caps at 200,
 * which is acceptable for an explicit, rare, operator-initiated action — and it is honest, because
 * it uses only endpoints that already exist rather than inventing a query the server cannot answer.
 */
export function useApplyApprovalLimitToRoleHolders() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({
      branchId,
      roleCode,
      approvalLimitPaisa,
    }: {
      branchId: string;
      roleCode: string;
      approvalLimitPaisa: number | null;
    }): Promise<ApprovalLimitApplyOutcome[]> => {
      const roster = await UserRepository.list({ size: 200, activeOnly: true });

      const holders: { id: string; email: string }[] = [];
      for (const candidate of roster.data) {
        const detail = await UserRepository.get(candidate.id);
        const holdsIt = detail.assignments.some(
          (a) => a.branchId === branchId && a.roleCode === roleCode,
        );
        if (holdsIt) holders.push({ id: candidate.id, email: candidate.email });
      }

      const outcomes: ApprovalLimitApplyOutcome[] = [];
      for (const holder of holders) {
        try {
          await UserRepository.assignBranchRole(holder.id, {
            branchId,
            roleCode,
            approvalLimitPaisa,
          });
          outcomes.push({ userId: holder.id, email: holder.email, ok: true });
        } catch (error) {
          outcomes.push({
            userId: holder.id,
            email: holder.email,
            ok: false,
            error: formatUserFacingError(error),
          });
        }
      }
      return outcomes;
    },
    onSuccess: invalidate,
  });
}

export type { UserListParams };
