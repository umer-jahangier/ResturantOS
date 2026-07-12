"use client";

import { useQuery } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

export function useMenuCategories() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.menuCategories(branchId),
    queryFn: () => PosRepository.getMenuCategories(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useMenuItems(categoryId?: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.menuItems(branchId, categoryId),
    queryFn: () => PosRepository.getMenuItems({ categoryId, branchId }),
    enabled: isAuthenticated && !!branchId,
  });
}
