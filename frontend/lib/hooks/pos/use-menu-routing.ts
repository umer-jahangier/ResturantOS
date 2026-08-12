"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MenuRoutingRepository } from "@/lib/repositories/menu-routing.repository";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { MenuRouting } from "@/lib/models/menu-routing.model";
// Type-only import — permitted from lib/hooks/** (the layer rule covers components/** and
// app/** only); same justification as use-station-admin.ts and use-menu-admin.ts.
import type { ApiError } from "@/lib/api-client/errors";

/**
 * Station-routing hooks (S1-01) — the first frontend callers the two 28-05 write endpoints have
 * ever had.
 *
 * <h3>Branch-scoped keys, deliberately</h3>
 *
 * A station code is unique within a BRANCH, and routing is stored per branch. Sharing one cache
 * entry across branches would show a manager who switched branches the routing of the branch they
 * left — which is precisely the failure mode 28-05's per-branch route tables exist to prevent, and
 * it would be invisible because the answer looks perfectly plausible.
 *
 * <h3>Writes refetch rather than patch</h3>
 *
 * The category write answers `204`, so there is no row to fold into the cache. More importantly,
 * changing one category's route changes the EFFECTIVE station of every item in it that has no
 * exception — the server resolves that, and only a refetch tells the truth about it. A local patch
 * would leave the item rows showing yesterday's destinations, which is the failure this whole
 * screen exists to make impossible.
 */
export const menuRoutingKeys = {
  all: (branchId: string) => ["pos", branchId, "menu-routing"] as const,
};

export function useMenuRouting() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<MenuRouting, ApiError>({
    queryKey: menuRoutingKeys.all(branchId),
    queryFn: () => MenuRoutingRepository.getRouting(branchId),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useAssignCategoryStation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<void, ApiError, { categoryId: string; stationId: string | null }>({
    mutationFn: ({ categoryId, stationId }) =>
      MenuRoutingRepository.assignCategoryStation(categoryId, branchId, stationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: menuRoutingKeys.all(branchId) });
      // The till's menu carries `effectiveStationCode` too. Leaving it stale is how a screen and
      // a ticket end up disagreeing about where a dish goes.
      void qc.invalidateQueries({ queryKey: ["pos", branchId, "menu"] });
    },
  });
}

export function useAssignItemStation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<void, ApiError, { itemId: string; stationId: string | null }>({
    mutationFn: ({ itemId, stationId }) =>
      MenuRoutingRepository.assignItemStation(itemId, branchId, stationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: menuRoutingKeys.all(branchId) });
      void qc.invalidateQueries({ queryKey: ["pos", branchId, "menu"] });
    },
  });
}
