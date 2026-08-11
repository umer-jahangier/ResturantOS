"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { DiningTable } from "@/lib/models/pos.model";
import type { CreateDiningTableInput } from "@/lib/api-client/schemas/pos.schema";
// Type-only import — permitted from lib/hooks/** (the layer rule covers components/** and
// app/** only); same justification as use-menu-admin.ts.
import type { ApiError } from "@/lib/api-client/errors";

/**
 * Dining-table CATALOGUE hooks (19b) — create, rename, re-capacity, retire, reactivate.
 *
 * <p>Separate from {@code useTables} in {@code use-orders.ts}, which is the service-time list
 * the order picker reads. That one is active-only and needs only {@code pos.order.view}; these
 * need {@code pos.tables.admin}, which a waiter does not hold. Keeping them apart is what stops
 * a manager's catalogue response (retired tables included) from being served to the picker out
 * of a shared cache entry.
 */
export function useTablesAdmin() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.tablesAdmin(branchId),
    queryFn: () => PosRepository.getTablesForAdmin(branchId),
    enabled: isAuthenticated && !!branchId,
  });
}

/**
 * Invalidates BOTH lists on every write. A newly created table has to appear in the picker a
 * waiter is looking at, and a retired one has to disappear from it — invalidating only the
 * catalogue would leave the terminal offering a table that no longer exists until its cache
 * expired. `["pos", branchId, "tables"]` is a prefix of the admin key, so this covers both.
 */
function invalidateTableQueries(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  qc.invalidateQueries({ queryKey: queryKeys.pos.tables(branchId) });
}

export function useCreateTable() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<DiningTable, ApiError, CreateDiningTableInput>({
    mutationFn: (input) => PosRepository.createTable(branchId, input),
    onSuccess: () => invalidateTableQueries(qc, branchId),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<DiningTable, ApiError, { id: string; input: CreateDiningTableInput }>({
    mutationFn: ({ id, input }) => PosRepository.updateTable(id, branchId, input),
    onSuccess: () => invalidateTableQueries(qc, branchId),
  });
}

export function useSetTableActive() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<DiningTable, ApiError, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) => PosRepository.setTableActive(id, branchId, active),
    onSuccess: () => invalidateTableQueries(qc, branchId),
  });
}
