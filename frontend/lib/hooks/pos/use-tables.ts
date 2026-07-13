"use client";

import { useQuery } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * Table-centric dine-in detail (POS-10): the table's active (non-terminal) order, if any,
 * plus a live bill summary and derived status. Backs both the Table Floor View drawer and
 * (via the same shared drawer component) the Order Management row-click drawer.
 */
export function useTableDetail(tableId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.tableDetail(branchId, tableId),
    queryFn: () => PosRepository.getActiveOrderForTable(tableId, branchId),
    enabled: isAuthenticated && !!branchId && !!tableId,
  });
}
