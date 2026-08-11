import { z } from "zod";

// Layer-1 HR API schemas. Raw shapes returned by /api/v1/hr/**, validated before adapting.
// Money is in paisa (integers). PII (cnic/bank) arrives already MASKED from the backend.

export const employmentTypeSchema = z.enum(["PERMANENT", "PART_TIME", "DAILY_WAGE", "CONTRACT"]);

/**
 * `department` and `designation` used to be free-text strings on this response, and 35-05 moved
 * them onto the tenant-managed `departments` / `designations` tables. The API now returns BOTH the
 * id and the resolved name — the id so a form can preselect the right option, the name so a table
 * renders without a second request per row.
 *
 * Both are optional here because an employee genuinely may have neither, and because a client
 * built against the old shape must not hard-fail on a response that simply omits them.
 */
export const apiEmployeeSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  employeeNo: z.string(),
  fullName: z.string(),
  userId: z.string().nullable().optional(),
  cnicMasked: z.string().nullable().optional(),
  bankAccountMasked: z.string().nullable().optional(),
  designationId: z.string().nullable().optional(),
  designationName: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  departmentName: z.string().nullable().optional(),
  employmentType: employmentTypeSchema,
  joinDate: z.string(),
  exitDate: z.string().nullable().optional(),
  basicSalaryPaisa: z.number(),
  deviceUserRef: z.string().nullable().optional(),
  active: z.boolean(),
});

export const createEmployeeInputSchema = z.object({
  employeeNo: z.string().min(1),
  fullName: z.string().min(1),
  userId: z.string().optional(),
  cnic: z.string().optional(),
  bankAccountNo: z.string().optional(),
  // Ids, not free text. A text box here is what produced "Waiter", "waiter" and "Wtr" as three
  // departments that no report could group — the defect the user complained about (D-35-01).
  designationId: z.string().optional(),
  departmentId: z.string().optional(),
  employmentType: employmentTypeSchema,
  joinDate: z.string(),
  basicSalaryPaisa: z.number(),
  deviceUserRef: z.string().optional(),
});

/** PUT /api/v1/hr/employees/{id} — no employeeNo, no joinDate; both are fixed at creation. */
export const updateEmployeeInputSchema = createEmployeeInputSchema.omit({
  employeeNo: true,
  joinDate: true,
});

// ── Tenant-managed HR configuration (35-05, 35-06) ──────────────────────────

export const apiDepartmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  active: z.boolean(),
});

export const apiDesignationSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  active: z.boolean(),
});

export const lookupInputSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
});

export const designationInputSchema = lookupInputSchema.extend({
  departmentId: z.string().optional(),
});

/**
 * One income-tax band.
 *
 * <p>`ratePct` is a NUMBER here and the server holds it as NUMERIC(6,3) applied through BigDecimal
 * with HALF_UP. A rate typed as 11.500 is representable exactly in JSON and in the server's
 * decimal path; it is NOT exactly representable as a double, which is why the server stopped using
 * one. Do not do arithmetic on this value in the client — display it and send it back.
 */
export const apiTaxSlabSchema = z.object({
  minPaisa: z.number(),
  maxPaisa: z.number().nullable().optional(),
  baseTaxPaisa: z.number(),
  ratePct: z.number(),
});

export const apiTaxConfigSchema = z.object({
  id: z.string(),
  fiscalYear: z.number(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  slabs: z.array(apiTaxSlabSchema),
  surchargeThresholdPaisa: z.number(),
  surchargeRatePct: z.number(),
  eobiEmployerRatePct: z.number(),
  eobiEmployeeRatePct: z.number(),
  eobiWageBasePaisa: z.number(),
  prorationMethod: z.string(),
  active: z.boolean(),
});

export const apiTaxConfigSummarySchema = z.object({
  id: z.string(),
  fiscalYear: z.number(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  active: z.boolean(),
  bandCount: z.number(),
});

/**
 * Which fiscal year today falls in — asked of the server, never computed here.
 *
 * <p>Pakistan's fiscal year begins on 1 July and is named for the calendar year it ends in. A
 * TypeScript copy of that rule would be a second implementation of a statutory convention, and
 * when the two drift the symptom is not a crash: it is a screen cheerfully configuring FY2026 while
 * payroll refuses because FY2027 is missing, with both halves apparently working. The server owns
 * it in `FiscalYear.java`.
 */
export const apiCurrentFiscalYearSchema = z.object({
  fiscalYear: z.number(),
  startsOn: z.string(),
  endsOn: z.string(),
  configured: z.boolean(),
});

export const saveTaxConfigInputSchema = z.object({
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  slabs: z.array(apiTaxSlabSchema),
  surchargeThresholdPaisa: z.number(),
  surchargeRatePct: z.number(),
  eobiEmployerRatePct: z.number(),
  eobiEmployeeRatePct: z.number(),
  eobiWageBasePaisa: z.number(),
  prorationMethod: z.string(),
  active: z.boolean(),
});

export const payrollStatusSchema = z.enum(["DRAFT", "CALCULATED", "APPROVED", "PAID", "REVERSED"]);

export const apiPayrollRunSchema = z.object({
  id: z.string(),
  periodMonth: z.number(),
  periodYear: z.number(),
  status: payrollStatusSchema,
  totalGrossPaisa: z.number(),
  totalNetPaisa: z.number(),
  branchId: z.string().nullable().optional(),
  runBy: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
});

export const apiPayslipSchema = z.object({
  id: z.string(),
  runId: z.string(),
  employeeId: z.string(),
  basicPaisa: z.number(),
  allowances: z.record(z.string(), z.number()).nullable().optional(),
  grossPaisa: z.number(),
  deductions: z.record(z.string(), z.number()).nullable().optional(),
  netPaisa: z.number(),
});

export const apiShiftSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  name: z.string(),
  roleDesignation: z.string().nullable().optional(),
  startTime: z.string(),
  endTime: z.string(),
  daysOfWeek: z.array(z.number()),
});

export const apiAssignmentSchema = z.object({
  id: z.string(),
  shiftId: z.string(),
  employeeId: z.string(),
  workDate: z.string(),
});

export const apiWeekGridSchema = z.object({
  shifts: z.array(apiShiftSchema),
  assignments: z.array(apiAssignmentSchema),
});

export const apiPunchSchema = z.object({
  id: z.string(),
  employeeId: z.string().nullable().optional(),
  punchType: z.string(),
  deviceReportedAt: z.string(),
  serverReceivedAt: z.string().nullable().optional(),
});

export const apiAttendanceSummarySchema = z.object({
  employeeId: z.string(),
  date: z.string(),
  firstIn: z.string().nullable().optional(),
  lastOut: z.string().nullable().optional(),
  lateMinutes: z.number(),
  earlyMinutes: z.number(),
});

export const apiLeaveTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  paid: z.boolean(),
  accrualDaysPerMonth: z.number(),
});

export const apiLeaveRequestSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  leaveTypeId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  approvedBy: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

export const apiLeaveBalanceSchema = z.object({
  leaveTypeId: z.string(),
  periodYear: z.number(),
  balanceDays: z.number(),
});

export const apiQuarantineSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  deviceUserRef: z.string(),
  punchType: z.string().nullable().optional(),
  deviceReportedAt: z.string(),
  rawLine: z.string().nullable().optional(),
  status: z.enum(["PENDING", "RESOLVED"]),
  resolvedEmployeeId: z.string().nullable().optional(),
});

export const apiLabourCostByBranchSchema = z.object({
  branchId: z.string(),
  periodMonth: z.number(),
  periodYear: z.number(),
  labourCostPaisa: z.number(),
  revenuePaisa: z.number().nullable().optional(),
  labourCostPct: z.number().nullable().optional(),
});

export type ApiEmployee = z.infer<typeof apiEmployeeSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeInputSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeInputSchema>;
export type ApiDepartment = z.infer<typeof apiDepartmentSchema>;
export type ApiDesignation = z.infer<typeof apiDesignationSchema>;
export type LookupInput = z.infer<typeof lookupInputSchema>;
export type DesignationInput = z.infer<typeof designationInputSchema>;
export type ApiTaxSlab = z.infer<typeof apiTaxSlabSchema>;
export type ApiTaxConfig = z.infer<typeof apiTaxConfigSchema>;
export type ApiTaxConfigSummary = z.infer<typeof apiTaxConfigSummarySchema>;
export type ApiCurrentFiscalYear = z.infer<typeof apiCurrentFiscalYearSchema>;
export type SaveTaxConfigInput = z.infer<typeof saveTaxConfigInputSchema>;
export type ApiPayrollRun = z.infer<typeof apiPayrollRunSchema>;
export type ApiPayslip = z.infer<typeof apiPayslipSchema>;
export type ApiShift = z.infer<typeof apiShiftSchema>;
export type ApiAssignment = z.infer<typeof apiAssignmentSchema>;
export type ApiWeekGrid = z.infer<typeof apiWeekGridSchema>;
export type ApiPunch = z.infer<typeof apiPunchSchema>;
export type ApiAttendanceSummary = z.infer<typeof apiAttendanceSummarySchema>;
export type ApiLeaveType = z.infer<typeof apiLeaveTypeSchema>;
export type ApiLeaveRequest = z.infer<typeof apiLeaveRequestSchema>;
export type ApiLeaveBalance = z.infer<typeof apiLeaveBalanceSchema>;
export type ApiQuarantine = z.infer<typeof apiQuarantineSchema>;
export type ApiLabourCostByBranch = z.infer<typeof apiLabourCostByBranchSchema>;
