"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ModifierRepository } from "@/lib/repositories/modifier.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { ModifierGroup, ModifierOption } from "@/lib/models/modifier.model";
import type {
  CreateModifierGroupInput,
  CreateModifierInput,
  UpdateModifierGroupInput,
  UpdateModifierInput,
} from "@/lib/api-client/schemas/modifier.schema";
// Type-only import — permitted from lib/hooks/** (the ESLint layer rule blocks components/**).
import type { ApiError } from "@/lib/api-client/errors";

/**
 * The TILL's read of the modifier catalogue (S6): every active group in the tenant, in one call.
 *
 * <h3>Why the whole catalogue, and not one dish per tap</h3>
 *
 * A per-tap fetch puts a network round trip between the cashier's finger and the configure
 * dialog, and an offline terminal could not configure a dish at all. Groups exist only for dishes
 * that have them, so the answer is proportional to what the tenant configured rather than to the
 * size of the menu — on a menu of 40 dishes with modifiers on 3, this is 3 rows.
 *
 * <h3>The query is held WHOLE by callers</h3>
 *
 * Not destructured to `{ data = [] }`. A failed read has no trustworthy `data`, and defaulting to
 * an empty array here would tell the till "this dish has no options" when the truth is "we could
 * not find out" — which for a FORCED group means ringing a dish with no spice level on it. GA-001,
 * in a place where it costs a remake rather than a refresh.
 */
export function useModifierCatalogue() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.modifierCatalogue(),
    queryFn: () => ModifierRepository.listAll(),
    enabled: isAuthenticated,
    // The catalogue changes when a manager edits it, which is rare and never mid-tap. A minute of
    // staleness costs nothing and keeps the till off the network during a rush.
    staleTime: 60_000,
  });
}

/**
 * The catalogue indexed by menu item, so a tap is a Map lookup rather than a scan.
 *
 * <p>Returns `undefined` for the index while the read is still in flight or has FAILED — the two
 * cases a caller must not treat as "this dish has no options". `isError` is passed through
 * untouched so the terminal can say so.
 */
export function useModifierGroupsByItem(): {
  byItem: Map<string, ModifierGroup[]> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => void;
} {
  const query = useModifierCatalogue();
  const byItem = useMemo(() => {
    if (!query.data) return undefined;
    const map = new Map<string, ModifierGroup[]>();
    for (const group of query.data) {
      const list = map.get(group.menuItemId);
      if (list) list.push(group);
      else map.set(group.menuItemId, [group]);
    }
    return map;
  }, [query.data]);

  return {
    byItem,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

/** The MANAGE screen's read for one dish — includes retired groups and retired options. */
export function useModifierGroupsAdmin(menuItemId: string | null) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.modifierGroupsAdmin(menuItemId ?? ""),
    queryFn: () => ModifierRepository.listForItemAdmin(menuItemId as string),
    enabled: isAuthenticated && !!menuItemId,
  });
}

/**
 * Every write invalidates BOTH keys.
 *
 * <p>Not cosmetic. The till holds the catalogue for a minute; a manager who prices "Extra cheese"
 * and then walks to the terminal must not be shown the old price by a cache that had no reason to
 * know. Invalidating the till key from the manage screen is the only thing that makes the two
 * screens agree without a reload.
 */
function invalidateCatalogue(
  qc: ReturnType<typeof useQueryClient>,
  menuItemId?: string,
) {
  qc.invalidateQueries({ queryKey: queryKeys.pos.modifierCatalogue() });
  if (menuItemId) {
    qc.invalidateQueries({ queryKey: queryKeys.pos.modifierGroupsAdmin(menuItemId) });
  } else {
    qc.invalidateQueries({ queryKey: ["pos", "modifier-groups", "admin"] });
  }
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation<ModifierGroup, ApiError, { menuItemId: string; input: CreateModifierGroupInput }>(
    {
      mutationFn: ({ menuItemId, input }) => ModifierRepository.createGroup(menuItemId, input),
      onSuccess: (_data, vars) => invalidateCatalogue(qc, vars.menuItemId),
    },
  );
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation<
    ModifierGroup,
    ApiError,
    { groupId: string; menuItemId: string; input: UpdateModifierGroupInput }
  >({
    mutationFn: ({ groupId, input }) => ModifierRepository.updateGroup(groupId, input),
    onSuccess: (_data, vars) => invalidateCatalogue(qc, vars.menuItemId),
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { groupId: string; menuItemId: string }>({
    mutationFn: ({ groupId }) => ModifierRepository.removeGroup(groupId),
    onSuccess: (_data, vars) => invalidateCatalogue(qc, vars.menuItemId),
  });
}

export function useCreateModifierOption() {
  const qc = useQueryClient();
  return useMutation<
    ModifierOption,
    ApiError,
    { groupId: string; menuItemId: string; input: CreateModifierInput }
  >({
    mutationFn: ({ groupId, input }) => ModifierRepository.createOption(groupId, input),
    onSuccess: (_data, vars) => invalidateCatalogue(qc, vars.menuItemId),
  });
}

export function useUpdateModifierOption() {
  const qc = useQueryClient();
  return useMutation<
    ModifierOption,
    ApiError,
    { modifierId: string; menuItemId: string; input: UpdateModifierInput }
  >({
    mutationFn: ({ modifierId, input }) => ModifierRepository.updateOption(modifierId, input),
    onSuccess: (_data, vars) => invalidateCatalogue(qc, vars.menuItemId),
  });
}

export function useDeleteModifierOption() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { modifierId: string; menuItemId: string }>({
    mutationFn: ({ modifierId }) => ModifierRepository.removeOption(modifierId),
    onSuccess: (_data, vars) => invalidateCatalogue(qc, vars.menuItemId),
  });
}
