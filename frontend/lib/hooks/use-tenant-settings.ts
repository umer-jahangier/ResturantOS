"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SettingsRepository } from "@/lib/repositories/settings.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { BranchDraft, BranchSettingsPatch } from "@/lib/models/tenant-settings.model";

export const settingsKeys = {
  all: () => ["tenant-settings"] as const,
  branch: (branchId: string) => ["tenant-settings", "branch", branchId] as const,
  branches: () => ["tenant-settings", "branches"] as const,
};

/**
 * The active branch's stored configuration.
 *
 * <p>Keyed on the branch id so a branch switch re-reads rather than showing the previous branch's
 * address under the new branch's name — the shell already remounts on switch, but a cache keyed
 * only on "settings" would survive that remount and be wrong.
 */
export function useBranchSettings(branchId: string | null) {
  return useQuery({
    queryKey: settingsKeys.branch(branchId ?? ""),
    queryFn: () => SettingsRepository.getBranch(branchId as string),
    enabled: Boolean(branchId),
  });
}

/** Every branch in the tenant — the branch picker on the create-user form. */
export function useTenantBranches(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.branches(),
    queryFn: () => SettingsRepository.listBranches(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateBranchSettings(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: BranchSettingsPatch) =>
      SettingsRepository.updateBranch(branchId as string, patch),
    onSuccess: (updated) => {
      // Seed the detail cache from the SERVER's answer, not from the submitted form values: the
      // response is what was actually stored, and if the two ever differ the stored one is the
      // truth the next reader will see.
      queryClient.setQueryData(settingsKeys.branch(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all() });
    },
  });
}

/**
 * Add a branch to the tenant.
 *
 * <p>Also invalidates the branch SWITCHER, not just the branch list. The server puts the creating
 * administrator on the new branch, so the set of places that person may work has changed — and the
 * switcher is a different query, under a different key, in a different hook. Invalidating only
 * `settingsKeys` would leave the new branch on this screen and absent from the switcher until the
 * next full page load, which is exactly the kind of half-applied state this screen exists to fix.
 */
export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: BranchDraft) => SettingsRepository.createBranch(draft),
    onSuccess: (created) => {
      queryClient.setQueryData(settingsKeys.branch(created.id), created);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.branches.mine() });
    },
  });
}

/**
 * Edit ANY branch by id — rename it, change its address or time zone, deactivate or restore it.
 *
 * <p>Distinct from {@link useUpdateBranchSettings}, which is bound to the branch the user is signed
 * in on and is what the Settings screen edits. This one takes the id per call, because the Branches
 * screen edits branches the administrator is not standing on. Same endpoint, same patch semantics.
 */
export function useUpdateBranchById() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, patch }: { branchId: string; patch: BranchSettingsPatch }) =>
      SettingsRepository.updateBranch(branchId, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsKeys.branch(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all() });
      // Deactivating a branch removes it from the switcher; restoring one puts it back. Both are
      // changes to `/api/v1/branches/mine`, which this hook does not own but must not leave stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.branches.mine() });
    },
  });
}

