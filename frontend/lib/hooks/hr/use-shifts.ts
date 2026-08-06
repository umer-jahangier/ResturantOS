"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HrRepository } from "@/lib/repositories/hr.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { ApiError } from "@/lib/api-client/errors";
import type { CreateShiftInput, Shift, ShiftAssignment, WeekGrid } from "@/lib/models/hr.model";

// Layer-3 schedule hooks (HR-04). Every write invalidates the `shifts` PREFIX rather
// than the one visible week: a move can land an assignment on a different week, and
// creating/deleting a shift changes the row set on every week at once. Prefix-matching
// also removes the remount-by-`key` hack the Schedule page needed to see its own writes.

export function useWeekGrid(weekStart: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<WeekGrid, ApiError>({
    queryKey: queryKeys.hr.weekGrid(branchId, weekStart),
    queryFn: () => HrRepository.weekGrid(weekStart),
    enabled: isAuthenticated && !!branchId && !!weekStart,
  });
}

function useShiftMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.shifts(branchId) });
    },
  });
}

export function useCreateShift() {
  return useShiftMutation<Shift, CreateShiftInput>((input) => HrRepository.createShift(input));
}

export function useDeleteShift() {
  return useShiftMutation<void, string>((id) => HrRepository.deleteShift(id));
}

export function useAssignShift() {
  return useShiftMutation<
    ShiftAssignment,
    { shiftId: string; employeeId: string; workDate: string }
  >(({ shiftId, employeeId, workDate }) => HrRepository.assign(shiftId, employeeId, workDate));
}

export function useMoveAssignment() {
  return useShiftMutation<
    ShiftAssignment,
    { assignmentId: string; newShiftId: string; newWorkDate: string }
  >(({ assignmentId, newShiftId, newWorkDate }) =>
    HrRepository.moveAssignment(assignmentId, newShiftId, newWorkDate),
  );
}

export function useUnassign() {
  return useShiftMutation<void, string>((assignmentId) => HrRepository.unassign(assignmentId));
}
