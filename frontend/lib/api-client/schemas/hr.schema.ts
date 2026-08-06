import { z } from "zod";

// Layer-1 HR API schemas. Raw shapes returned by /api/v1/hr/**, validated before adapting.
// Money is in paisa (integers). PII (cnic/bank) arrives already MASKED from the backend.

export const employmentTypeSchema = z.enum(["PERMANENT", "PART_TIME", "DAILY_WAGE", "CONTRACT"]);

export const apiEmployeeSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  employeeNo: z.string(),
  fullName: z.string(),
  userId: z.string().nullable().optional(),
  cnicMasked: z.string().nullable().optional(),
  bankAccountMasked: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
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
  designation: z.string().optional(),
  department: z.string().optional(),
  employmentType: employmentTypeSchema,
  joinDate: z.string(),
  basicSalaryPaisa: z.number(),
  deviceUserRef: z.string().optional(),
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
