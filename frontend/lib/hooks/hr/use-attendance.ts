"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HrRepository } from "@/lib/repositories/hr.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { ApiError } from "@/lib/api-client/errors";
import type {
  AttendancePunch,
  AttendanceSummary,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  QuarantinedPunch,
} from "@/lib/models/hr.model";

// Layer-3 attendance / leave / quarantine hooks (HR-02, HR-05).

// ── Attendance ───────────────────────────────────────────────────────────────

export function useAttendancePunches(employeeId: string, date: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<AttendancePunch[], ApiError>({
    queryKey: queryKeys.hr.attendancePunches(branchId, employeeId, date),
    queryFn: () => HrRepository.punches(employeeId, date),
    enabled: isAuthenticated && !!branchId && !!employeeId && !!date,
  });
}

/**
 * Daily late/early-leave summary for one employee. Disabled until an employee is picked,
 * so the screen shows nothing rather than an arbitrary someone's figures — and a clock
 * punch invalidates it, which is what refreshes the line under the buttons.
 */
export function useAttendanceSummary(employeeId: string, date: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<AttendanceSummary, ApiError>({
    queryKey: queryKeys.hr.attendanceSummary(branchId, employeeId, date),
    queryFn: () => HrRepository.summary(employeeId, date),
    enabled: isAuthenticated && !!branchId && !!employeeId && !!date,
  });
}

/** Manual clock-in/clock-out. Invalidates the whole attendance prefix (punches + summary). */
export function useClockPunch() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<AttendancePunch, ApiError, { employeeId: string; kind: "in" | "out" }>({
    mutationFn: ({ employeeId, kind }) =>
      kind === "in" ? HrRepository.clockIn(employeeId) : HrRepository.clockOut(employeeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.attendance(branchId) });
    },
  });
}

// ── Quarantine ───────────────────────────────────────────────────────────────

/** Device punches that matched no employee — the mapping queue on the Attendance screen. */
export function useQuarantine() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<QuarantinedPunch[], ApiError>({
    queryKey: queryKeys.hr.quarantine(branchId),
    queryFn: () => HrRepository.listQuarantine(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useResolveQuarantine() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { id: string; employeeId: string }>({
    mutationFn: ({ id, employeeId }) => HrRepository.resolveQuarantine(id, employeeId),
    onSuccess: () => {
      // Resolving saves a device-ref→employee mapping, so it both clears the row AND
      // changes what future punches resolve to — invalidate all attendance, not just
      // the quarantine list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.attendance(branchId) });
    },
  });
}

// ── Leave ────────────────────────────────────────────────────────────────────

export function useLeaveTypes() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<LeaveType[], ApiError>({
    queryKey: queryKeys.hr.leaveTypes(branchId),
    queryFn: () => HrRepository.listLeaveTypes(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useLeaveBalances(employeeId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<LeaveBalance[], ApiError>({
    queryKey: queryKeys.hr.leaveBalances(branchId, employeeId),
    queryFn: () => HrRepository.leaveBalances(employeeId),
    enabled: isAuthenticated && !!branchId && !!employeeId,
  });
}

/** Seeds the tenant's default leave types when none exist yet. */
export function useEnsureLeaveDefaults() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<LeaveType[], ApiError, void>({
    mutationFn: () => HrRepository.ensureLeaveDefaults(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.leaveTypes(branchId) });
    },
  });
}

export function useRequestLeave() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<
    LeaveRequest,
    ApiError,
    {
      employeeId: string;
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      reason?: string;
    }
  >({
    mutationFn: (input) => HrRepository.requestLeave(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.leave(branchId) });
    },
  });
}

/** Approve or reject a pending request — one hook, since both hit the same cache. */
export function useDecideLeave() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<LeaveRequest, ApiError, { id: string; decision: "approve" | "reject" }>({
    mutationFn: ({ id, decision }) =>
      decision === "approve" ? HrRepository.approveLeave(id) : HrRepository.rejectLeave(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.leave(branchId) });
    },
  });
}
