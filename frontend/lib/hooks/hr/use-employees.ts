"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HrRepository } from "@/lib/repositories/hr.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { ApiError } from "@/lib/api-client/errors";
import type { CreateEmployeeInput } from "@/lib/api-client/schemas/hr.schema";
import type { Employee } from "@/lib/models/hr.model";

// Layer-3 HR employee hooks (HR-01). The HR pages used to call HrRepository straight
// from the component and hand-roll useState + useEffect + load(), which skipped the
// cache, re-fetched the roster on every mount, and left three screens each holding
// their own copy of the same list. Every other module (pos/finance/inventory/…) goes
// through hooks like these; HR now does too.

/** Active-branch employee roster. Shared by the Employees, Attendance and Schedule screens. */
export function useEmployees() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<Employee[], ApiError>({
    queryKey: queryKeys.hr.employees(branchId),
    queryFn: () => HrRepository.listEmployees(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useCreateEmployee() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<Employee, ApiError, CreateEmployeeInput>({
    mutationFn: (input) => HrRepository.createEmployee(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.employees(branchId) });
    },
  });
}

export function useUpdateEmployee() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<
    Employee,
    ApiError,
    { id: string; input: Omit<CreateEmployeeInput, "employeeNo" | "joinDate"> }
  >({
    mutationFn: ({ id, input }) => HrRepository.updateEmployee(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.employees(branchId) });
    },
  });
}

export function useDeactivateEmployee() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => HrRepository.deactivateEmployee(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.employees(branchId) });
    },
  });
}
