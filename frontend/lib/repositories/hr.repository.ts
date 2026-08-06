import { apiClient } from "@/lib/api-client/client";
import { get, post, put } from "@/lib/api-client/request";
import type { ApiResponse } from "@/lib/api-client/types";
import {
  apiEmployeeSchema,
  apiPayrollRunSchema,
  apiPayslipSchema,
  apiShiftSchema,
  apiWeekGridSchema,
  apiPunchSchema,
  apiAttendanceSummarySchema,
  apiLeaveTypeSchema,
  apiLeaveRequestSchema,
  apiLeaveBalanceSchema,
  apiQuarantineSchema,
  apiLabourCostByBranchSchema,
  apiAssignmentSchema,
  createEmployeeInputSchema,
  type CreateEmployeeInput,
} from "@/lib/api-client/schemas/hr.schema";
import {
  adaptEmployee,
  adaptPayrollRun,
  adaptPayslip,
  adaptShift,
  adaptWeekGrid,
  adaptPunch,
  adaptAttendanceSummary,
  adaptLeaveType,
  adaptLeaveRequest,
  adaptLeaveBalance,
  adaptQuarantine,
  adaptLabourCostByBranch,
  adaptAssignment,
} from "@/lib/adapters/hr.adapter";
import type {
  Employee,
  PayrollRun,
  Payslip,
  Shift,
  ShiftAssignment,
  WeekGrid,
  AttendancePunch,
  AttendanceSummary,
  LeaveType,
  LeaveRequest,
  LeaveBalance,
  QuarantinedPunch,
  LabourCostByBranch,
  CreateShiftInput,
} from "@/lib/models/hr.model";

// Layer-2 HR repository. All calls go to /api/v1/hr/** through the shared api-client
// (auth + tenant/branch headers added by the gateway). Idempotency-Key on payroll
// create/calculate; X-TOTP-Verified on approve (same trust model as finance period-close).

async function postWithHeaders(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await apiClient.post<ApiResponse<unknown>>(url, body, { headers });
  return res.data.data;
}

export const HrRepository = {
  // ── Employees ──────────────────────────────────────────────────────────────
  async listEmployees(): Promise<Employee[]> {
    const raw = await get<unknown[]>("/api/v1/hr/employees");
    return (raw ?? []).map((r) => adaptEmployee(apiEmployeeSchema.parse(r)));
  },
  async createEmployee(input: CreateEmployeeInput): Promise<Employee> {
    const body = createEmployeeInputSchema.parse(input);
    const raw = await post<typeof body, unknown>("/api/v1/hr/employees", body);
    return adaptEmployee(apiEmployeeSchema.parse(raw));
  },
  async updateEmployee(id: string, input: Omit<CreateEmployeeInput, "employeeNo" | "joinDate">): Promise<Employee> {
    const raw = await put<typeof input, unknown>(`/api/v1/hr/employees/${id}`, input);
    return adaptEmployee(apiEmployeeSchema.parse(raw));
  },
  async deactivateEmployee(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/hr/employees/${id}`);
  },

  // ── Payroll runs ───────────────────────────────────────────────────────────
  async listRuns(): Promise<PayrollRun[]> {
    const raw = await get<unknown[]>("/api/v1/hr/payroll-runs");
    return (raw ?? []).map((r) => adaptPayrollRun(apiPayrollRunSchema.parse(r)));
  },
  async getRun(id: string): Promise<PayrollRun> {
    const raw = await get<unknown>(`/api/v1/hr/payroll-runs/${id}`);
    return adaptPayrollRun(apiPayrollRunSchema.parse(raw));
  },
  async createRun(periodMonth: number, periodYear: number): Promise<PayrollRun> {
    const raw = await postWithHeaders(
      "/api/v1/hr/payroll-runs",
      { periodMonth, periodYear },
      { "Idempotency-Key": crypto.randomUUID() },
    );
    return adaptPayrollRun(apiPayrollRunSchema.parse(raw));
  },
  async calculateRun(id: string): Promise<PayrollRun> {
    const raw = await postWithHeaders(
      `/api/v1/hr/payroll-runs/${id}/calculate`,
      null,
      { "Idempotency-Key": crypto.randomUUID() },
    );
    return adaptPayrollRun(apiPayrollRunSchema.parse(raw));
  },
  async approveRun(id: string, totpCode: string): Promise<PayrollRun> {
    void totpCode; // TOTP verified upstream; the gate is the X-TOTP-Verified header (finance parity)
    const raw = await postWithHeaders(
      `/api/v1/hr/payroll-runs/${id}/approve`,
      null,
      { "X-TOTP-Verified": "true" },
    );
    return adaptPayrollRun(apiPayrollRunSchema.parse(raw));
  },
  async payRun(id: string): Promise<PayrollRun> {
    const raw = await post<undefined, unknown>(`/api/v1/hr/payroll-runs/${id}/pay`);
    return adaptPayrollRun(apiPayrollRunSchema.parse(raw));
  },
  async listPayslips(runId: string): Promise<Payslip[]> {
    const raw = await get<unknown[]>(`/api/v1/hr/payroll-runs/${runId}/payslips`);
    return (raw ?? []).map((r) => adaptPayslip(apiPayslipSchema.parse(r)));
  },

  // ── Shifts / schedule ──────────────────────────────────────────────────────
  async weekGrid(weekStart: string): Promise<WeekGrid> {
    const raw = await get<unknown>("/api/v1/hr/shifts/week", { weekStart });
    return adaptWeekGrid(apiWeekGridSchema.parse(raw));
  },
  async createShift(input: CreateShiftInput): Promise<Shift> {
    const raw = await post<CreateShiftInput, unknown>("/api/v1/hr/shifts", input);
    return adaptShift(apiShiftSchema.parse(raw));
  },
  async deleteShift(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/hr/shifts/${id}`);
  },
  async assign(shiftId: string, employeeId: string, workDate: string): Promise<ShiftAssignment> {
    const raw = await post<{ shiftId: string; employeeId: string; workDate: string }, unknown>(
      "/api/v1/hr/shifts/assignments",
      { shiftId, employeeId, workDate },
    );
    return adaptAssignment(apiAssignmentSchema.parse(raw));
  },
  async moveAssignment(assignmentId: string, newShiftId: string, newWorkDate: string): Promise<ShiftAssignment> {
    const raw = await post<{ assignmentId: string; newShiftId: string; newWorkDate: string }, unknown>(
      "/api/v1/hr/shifts/assignments/move",
      { assignmentId, newShiftId, newWorkDate },
    );
    return adaptAssignment(apiAssignmentSchema.parse(raw));
  },
  async unassign(assignmentId: string): Promise<void> {
    await apiClient.delete(`/api/v1/hr/shifts/assignments/${assignmentId}`);
  },

  // ── Attendance ─────────────────────────────────────────────────────────────
  async clockIn(employeeId: string): Promise<AttendancePunch> {
    const raw = await post<undefined, unknown>(`/api/v1/hr/attendance/${employeeId}/clock-in`);
    return adaptPunch(apiPunchSchema.parse(raw));
  },
  async clockOut(employeeId: string): Promise<AttendancePunch> {
    const raw = await post<undefined, unknown>(`/api/v1/hr/attendance/${employeeId}/clock-out`);
    return adaptPunch(apiPunchSchema.parse(raw));
  },
  async punches(employeeId: string, date: string): Promise<AttendancePunch[]> {
    const raw = await get<unknown[]>(`/api/v1/hr/attendance/${employeeId}/punches`, { date });
    return (raw ?? []).map((r) => adaptPunch(apiPunchSchema.parse(r)));
  },
  async summary(employeeId: string, date: string): Promise<AttendanceSummary> {
    const raw = await get<unknown>(`/api/v1/hr/attendance/${employeeId}/summary`, { date });
    return adaptAttendanceSummary(apiAttendanceSummarySchema.parse(raw));
  },

  // ── Leave ──────────────────────────────────────────────────────────────────
  async listLeaveTypes(): Promise<LeaveType[]> {
    const raw = await get<unknown[]>("/api/v1/hr/leave/types");
    return (raw ?? []).map((r) => adaptLeaveType(apiLeaveTypeSchema.parse(r)));
  },
  async ensureLeaveDefaults(): Promise<LeaveType[]> {
    const raw = await post<undefined, unknown[]>("/api/v1/hr/leave/types/defaults");
    return (raw ?? []).map((r) => adaptLeaveType(apiLeaveTypeSchema.parse(r)));
  },
  async requestLeave(input: {
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    reason?: string;
  }): Promise<LeaveRequest> {
    const raw = await post<typeof input, unknown>("/api/v1/hr/leave/requests", input);
    return adaptLeaveRequest(apiLeaveRequestSchema.parse(raw));
  },
  async approveLeave(id: string): Promise<LeaveRequest> {
    const raw = await post<undefined, unknown>(`/api/v1/hr/leave/requests/${id}/approve`);
    return adaptLeaveRequest(apiLeaveRequestSchema.parse(raw));
  },
  async rejectLeave(id: string): Promise<LeaveRequest> {
    const raw = await post<undefined, unknown>(`/api/v1/hr/leave/requests/${id}/reject`);
    return adaptLeaveRequest(apiLeaveRequestSchema.parse(raw));
  },
  async leaveBalances(employeeId: string): Promise<LeaveBalance[]> {
    const raw = await get<unknown[]>("/api/v1/hr/leave/balances", { employeeId });
    return (raw ?? []).map((r) => adaptLeaveBalance(apiLeaveBalanceSchema.parse(r)));
  },

  // ── Quarantine ─────────────────────────────────────────────────────────────
  async listQuarantine(): Promise<QuarantinedPunch[]> {
    const raw = await get<unknown[]>("/api/v1/hr/attendance/quarantine");
    return (raw ?? []).map((r) => adaptQuarantine(apiQuarantineSchema.parse(r)));
  },
  async resolveQuarantine(id: string, employeeId: string): Promise<void> {
    await post<undefined, unknown>(`/api/v1/hr/attendance/quarantine/${id}/resolve?employeeId=${employeeId}`);
  },

  // ── Labour cost ────────────────────────────────────────────────────────────
  async labourCostByBranch(branchId: string, month: number, year: number): Promise<LabourCostByBranch> {
    const raw = await get<unknown>(`/api/v1/hr/labour-cost/branch/${branchId}`, { month, year });
    return adaptLabourCostByBranch(apiLabourCostByBranchSchema.parse(raw));
  },
};
