"use client";

import { useQuery } from "@tanstack/react-query";

import { BranchRepository } from "@/lib/repositories/branch.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "./use-current-user";

/** Active branch assignments for the signed-in user (US-1.3 branch switcher). */
export function useMyBranches() {
  const { isAuthenticated } = useCurrentUser();

  return useQuery({
    queryKey: queryKeys.branches.mine(),
    queryFn: () => BranchRepository.listMine(),
    enabled: isAuthenticated,
  });
}
