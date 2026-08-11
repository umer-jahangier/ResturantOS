"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SettingsRepository } from "@/lib/repositories/settings.repository";
import type { BranchSettingsPatch } from "@/lib/models/tenant-settings.model";

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
