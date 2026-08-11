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
  updateEmployeeInputSchema,
  apiDepartmentSchema,
  apiDesignationSchema,
  lookupInputSchema,
  designationInputSchema,
  apiTaxConfigSchema,
  apiTaxConfigSummarySchema,
  apiCurrentFiscalYearSchema,
  saveTaxConfigInputSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
  type LookupInput,
  type DesignationInput,
  type SaveTaxConfigInput,
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
  adaptDepartment,
  adaptDesignation,
  adaptTaxConfig,
  adaptTaxConfigSummary,
  adaptCurrentFiscalYear,
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
  Department,
  Designation,
  TaxConfig,
  TaxConfigSummary,
  CurrentFiscalYear,
} from "@/lib/models/hr.model";

// Layer-2 HR repository. All calls go to /api/v1/hr/** through the shared api-client
// (auth + tenant/branch headers added by the gateway). Idempotency-Key on payroll
// create/calculate. Payroll approval is step-up gated, but the client sends nothing for it:
// the gate reads a signed JWT claim the gateway translates into a header — see approveRun.

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
  async updateEmployee(id: string, input: UpdateEmployeeInput): Promise<Employee> {
    const body = updateEmployeeInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(`/api/v1/hr/employees/${id}`, body);
    return adaptEmployee(apiEmployeeSchema.parse(raw));
  },
  async deactivateEmployee(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/hr/employees/${id}`);
  },

  // ── Tenant-managed lists (35-05) ───────────────────────────────────────────
  //
  // There is deliberately no delete on either list, and please do not add one for symmetry: a
  // department referenced by an employee cannot be removed without orphaning them or silently
  // rewriting their record. `setDepartmentActive(id, false)` is what an owner actually means by
  // "we do not have that department any more" — the row stays resolvable, and stops being offered.

  async listDepartments(): Promise<Department[]> {
    const raw = await get<unknown[]>("/api/v1/hr/config/departments");
    return (raw ?? []).map((r) => adaptDepartment(apiDepartmentSchema.parse(r)));
  },
  async createDepartment(input: LookupInput): Promise<Department> {
    const body = lookupInputSchema.parse(input);
    const raw = await post<typeof body, unknown>("/api/v1/hr/config/departments", body);
    return adaptDepartment(apiDepartmentSchema.parse(raw));
  },
  async renameDepartment(id: string, input: LookupInput): Promise<Department> {
    const body = lookupInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(`/api/v1/hr/config/departments/${id}`, body);
    return adaptDepartment(apiDepartmentSchema.parse(raw));
  },
  async setDepartmentActive(id: string, active: boolean): Promise<Department> {
    const raw = await put<{ active: boolean }, unknown>(
      `/api/v1/hr/config/departments/${id}/active`,
      { active },
    );
    return adaptDepartment(apiDepartmentSchema.parse(raw));
  },

  async listDesignations(): Promise<Designation[]> {
    const raw = await get<unknown[]>("/api/v1/hr/config/designations");
    return (raw ?? []).map((r) => adaptDesignation(apiDesignationSchema.parse(r)));
  },
  async createDesignation(input: DesignationInput): Promise<Designation> {
    const body = designationInputSchema.parse(input);
    const raw = await post<typeof body, unknown>("/api/v1/hr/config/designations", body);
    return adaptDesignation(apiDesignationSchema.parse(raw));
  },
  async renameDesignation(id: string, input: DesignationInput): Promise<Designation> {
    const body = designationInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(`/api/v1/hr/config/designations/${id}`, body);
    return adaptDesignation(apiDesignationSchema.parse(raw));
  },
  async setDesignationActive(id: string, active: boolean): Promise<Designation> {
    const raw = await put<{ active: boolean }, unknown>(
      `/api/v1/hr/config/designations/${id}/active`,
      { active },
    );
    return adaptDesignation(apiDesignationSchema.parse(raw));
  },

  // ── Tax configuration (35-06) ──────────────────────────────────────────────

  async listTaxConfigs(): Promise<TaxConfigSummary[]> {
    const raw = await get<unknown[]>("/api/v1/hr/config/tax");
    return (raw ?? []).map((r) => adaptTaxConfigSummary(apiTaxConfigSummarySchema.parse(r)));
  },
  /** The July rule lives in the server's `FiscalYear`; never reimplement it here. */
  async getCurrentFiscalYear(): Promise<CurrentFiscalYear> {
    const raw = await get<unknown>("/api/v1/hr/config/tax/current");
    return adaptCurrentFiscalYear(apiCurrentFiscalYearSchema.parse(raw));
  },
  /** Throws `ApiError` 409 `TAX_CONFIG_NOT_CONFIGURED` when that year has none. */
  async getTaxConfig(fiscalYear: number): Promise<TaxConfig> {
    const raw = await get<unknown>(`/api/v1/hr/config/tax/${fiscalYear}`);
    return adaptTaxConfig(apiTaxConfigSchema.parse(raw));
  },
  async saveTaxConfig(fiscalYear: number, input: SaveTaxConfigInput): Promise<TaxConfig> {
    const body = saveTaxConfigInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(`/api/v1/hr/config/tax/${fiscalYear}`, body);
    return adaptTaxConfig(apiTaxConfigSchema.parse(raw));
  },
  async setTaxConfigActive(fiscalYear: number, active: boolean): Promise<TaxConfig> {
    const raw = await put<{ active: boolean }, unknown>(
      `/api/v1/hr/config/tax/${fiscalYear}/active`,
      { active },
    );
    return adaptTaxConfig(apiTaxConfigSchema.parse(raw));
  },
  /**
   * Last year's figures as a draft for this one. Writes NOTHING — a GET, deliberately.
   *
   * Silently creating next year's table from last year's rates is how a rate superseded by a
   * Finance Act survives into a year it does not apply to, so the accountant is shown the figures
   * and their save is the confirmation. The draft comes back `active: false` for the same reason.
   */
  async draftTaxConfigFrom(
    fiscalYear: number,
    sourceFiscalYear: number,
  ): Promise<SaveTaxConfigInput> {
    const raw = await get<unknown>(
      `/api/v1/hr/config/tax/${fiscalYear}/draft-from?sourceFiscalYear=${sourceFiscalYear}`,
    );
    return saveTaxConfigInputSchema.parse(raw);
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
    const raw = await postWithHeaders(`/api/v1/hr/payroll-runs/${id}/calculate`, null, {
      "Idempotency-Key": crypto.randomUUID(),
    });
    return adaptPayrollRun(apiPayrollRunSchema.parse(raw));
  },
  /**
   * Step-up gated, and nothing in the request satisfies the gate: hr-service reads
   * `X-TOTP-Verified`, which the gateway writes from the signed `totp_verified` access-token
   * claim after deleting any inbound copy. Only a login that verified a TOTP code sets it.
   * A caller lacking the claim gets 403 `TOTP_REQUIRED` (finance period-close parity).
   */
  async approveRun(id: string): Promise<PayrollRun> {
    const raw = await post<undefined, unknown>(`/api/v1/hr/payroll-runs/${id}/approve`);
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
  async moveAssignment(
    assignmentId: string,
    newShiftId: string,
    newWorkDate: string,
  ): Promise<ShiftAssignment> {
    const raw = await post<
      { assignmentId: string; newShiftId: string; newWorkDate: string },
      unknown
    >("/api/v1/hr/shifts/assignments/move", { assignmentId, newShiftId, newWorkDate });
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
    await post<undefined, unknown>(
      `/api/v1/hr/attendance/quarantine/${id}/resolve?employeeId=${employeeId}`,
    );
  },

  // ── Labour cost ────────────────────────────────────────────────────────────
  async labourCostByBranch(
    branchId: string,
    month: number,
    year: number,
  ): Promise<LabourCostByBranch> {
    const raw = await get<unknown>(`/api/v1/hr/labour-cost/branch/${branchId}`, { month, year });
    return adaptLabourCostByBranch(apiLabourCostByBranchSchema.parse(raw));
  },
};
