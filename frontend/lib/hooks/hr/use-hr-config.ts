"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ApiError } from "@/lib/api-client/errors";
import type {
  DesignationInput,
  LookupInput,
  SaveTaxConfigInput,
} from "@/lib/api-client/schemas/hr.schema";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type {
  CurrentFiscalYear,
  Department,
  Designation,
  TaxConfig,
  TaxConfigSummary,
} from "@/lib/models/hr.model";
import { HrRepository } from "@/lib/repositories/hr.repository";

/**
 * Layer-3 hooks for the tenant-managed HR configuration (35-05, 35-06).
 *
 * <h2>Why these queries are not gated on a branch</h2>
 *
 * Every other HR hook is `enabled: isAuthenticated && !!branchId`, because employees, shifts and
 * payroll runs are branch-scoped. Configuration is not: `departments` and `designations` carry no
 * `branch_id` at all, and `tax_config` is keyed on (tenant, fiscal year). Requiring a branch here
 * would leave the department dropdown empty on any screen reached before a branch is selected —
 * which reads as "this tenant has no departments", the single most misleading thing an options list
 * can say.
 *
 * <h2>Permissions</h2>
 *
 * Reads need `hr.config.view`, writes `hr.config.manage` (35-03). The two codes exist so a manager
 * filling in an employee form can populate the dropdown without also being able to rewrite the tax
 * table. A caller lacking the read permission gets a 403, which surfaces as a query error — and the
 * shared `Select` renders an error with a retry rather than an empty menu.
 */

/** Every department, active and inactive. Filter to active where you are offering choices. */
export function useDepartments() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery<Department[], ApiError>({
    queryKey: queryKeys.hr.departments(),
    queryFn: () => HrRepository.listDepartments(),
    enabled: isAuthenticated,
    // A tenant's department list changes a handful of times a year. Refetching it on every mount
    // of every form that shows a dropdown is pure noise.
    staleTime: 5 * 60 * 1000,
  });
}

export function useDesignations() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery<Designation[], ApiError>({
    queryKey: queryKeys.hr.designations(),
    queryFn: () => HrRepository.listDesignations(),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}

function useInvalidate(key: readonly unknown[]) {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: key });
}

export function useCreateDepartment() {
  const invalidate = useInvalidate(queryKeys.hr.departments());
  return useMutation<Department, ApiError, LookupInput>({
    mutationFn: (input) => HrRepository.createDepartment(input),
    onSuccess: invalidate,
  });
}

export function useRenameDepartment() {
  const invalidate = useInvalidate(queryKeys.hr.departments());
  return useMutation<Department, ApiError, { id: string; input: LookupInput }>({
    mutationFn: ({ id, input }) => HrRepository.renameDepartment(id, input),
    onSuccess: invalidate,
  });
}

export function useSetDepartmentActive() {
  const invalidate = useInvalidate(queryKeys.hr.departments());
  return useMutation<Department, ApiError, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) => HrRepository.setDepartmentActive(id, active),
    onSuccess: invalidate,
  });
}

export function useCreateDesignation() {
  const invalidate = useInvalidate(queryKeys.hr.designations());
  return useMutation<Designation, ApiError, DesignationInput>({
    mutationFn: (input) => HrRepository.createDesignation(input),
    onSuccess: invalidate,
  });
}

export function useRenameDesignation() {
  const invalidate = useInvalidate(queryKeys.hr.designations());
  return useMutation<Designation, ApiError, { id: string; input: DesignationInput }>({
    mutationFn: ({ id, input }) => HrRepository.renameDesignation(id, input),
    onSuccess: invalidate,
  });
}

export function useSetDesignationActive() {
  const invalidate = useInvalidate(queryKeys.hr.designations());
  return useMutation<Designation, ApiError, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) => HrRepository.setDesignationActive(id, active),
    onSuccess: invalidate,
  });
}

// ── Tax configuration ────────────────────────────────────────────────────────

export function useTaxConfigs() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery<TaxConfigSummary[], ApiError>({
    queryKey: queryKeys.hr.taxConfigs(),
    queryFn: () => HrRepository.listTaxConfigs(),
    enabled: isAuthenticated,
  });
}

/** Asked of the server so the July rule has one implementation — see the repository method. */
export function useCurrentFiscalYear() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery<CurrentFiscalYear, ApiError>({
    queryKey: queryKeys.hr.currentFiscalYear(),
    queryFn: () => HrRepository.getCurrentFiscalYear(),
    enabled: isAuthenticated,
  });
}

/**
 * A year's configuration.
 *
 * <p>A year with none answers `409 TAX_CONFIG_NOT_CONFIGURED`, which arrives here as a query
 * ERROR, not as `undefined` data. That is deliberate on the server's part and must stay visible:
 * the screen distinguishes "not configured yet — here is a blank form" from "we could not reach
 * the server", and collapsing the two would put an empty tax table in front of an accountant who
 * has no way to know it is not theirs. `retry: false` because retrying a 409 cannot help.
 */
export function useTaxConfig(fiscalYear: number | null) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery<TaxConfig, ApiError>({
    queryKey: queryKeys.hr.taxConfig(fiscalYear ?? 0),
    queryFn: () => HrRepository.getTaxConfig(fiscalYear as number),
    enabled: isAuthenticated && fiscalYear != null,
    retry: false,
  });
}

export function useSaveTaxConfig() {
  const queryClient = useQueryClient();
  return useMutation<TaxConfig, ApiError, { fiscalYear: number; input: SaveTaxConfigInput }>({
    mutationFn: ({ fiscalYear, input }) => HrRepository.saveTaxConfig(fiscalYear, input),
    onSuccess: () => {
      // The whole config subtree: the year itself, the year list, and the current-year
      // `configured` flag, which a save is precisely what flips.
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.config() });
    },
  });
}

export function useSetTaxConfigActive() {
  const queryClient = useQueryClient();
  return useMutation<TaxConfig, ApiError, { fiscalYear: number; active: boolean }>({
    mutationFn: ({ fiscalYear, active }) => HrRepository.setTaxConfigActive(fiscalYear, active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.config() });
    },
  });
}
