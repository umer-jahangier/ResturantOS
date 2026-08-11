// Layer-2 HR domain models. Clean shapes the UI consumes. Money stays in paisa.

import { employmentTypeSchema } from "@/lib/api-client/schemas/hr.schema";

/**
 * The employment types, as a runtime list, DERIVED from the Layer-1 schema.
 *
 * <p>This existed as `const EMPLOYMENT_TYPES: EmploymentType[] = [...]` hand-written at the top of
 * `hr/employees/page.tsx`. A second screen wanting the same dropdown copies it, the two drift, and
 * one screen offers a value the API rejects — which is the same class of defect as the free-text
 * department, one layer up. Deriving it from `employmentTypeSchema.options` means adding a case to
 * the wire schema adds it to every picker, and the compiler will not let the two disagree.
 *
 * <p>It lives here rather than in the picker component because `components/**` may not import from
 * `lib/api-client/**` — the FE-08 layer boundary, lint-enforced. Layer 2 is where a wire fact
 * becomes a domain fact.
 */
export const EMPLOYMENT_TYPE_VALUES = employmentTypeSchema.options;

export type EmploymentType = "PERMANENT" | "PART_TIME" | "DAILY_WAGE" | "CONTRACT";
export type PayrollStatus = "DRAFT" | "CALCULATED" | "APPROVED" | "PAID" | "REVERSED";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
export type QuarantineStatus = "PENDING" | "RESOLVED";

export interface Employee {
  id: string;
  branchId: string;
  employeeNo: string;
  fullName: string;
  userId: string | null;
  cnicMasked: string | null;
  bankAccountMasked: string | null;
  /** The lookup row's id — what a form preselects. Null when the employee has none. */
  designationId: string | null;
  /** The resolved name — what a table renders, without a second request per row. */
  designationName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  employmentType: EmploymentType;
  joinDate: string;
  exitDate: string | null;
  basicSalaryPaisa: number;
  deviceUserRef: string | null;
  active: boolean;
}

/**
 * A tenant-managed list row (35-05). Departments and designations share this shape.
 *
 * <p>`active` is a real state, not a soft delete flag to be filtered away everywhere: an inactive
 * department still resolves, so an employee assigned to one before it was retired still renders
 * with a real name. A settings screen shows both; a picker offers only the active ones.
 */
export interface Department {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

export interface Designation {
  id: string;
  name: string;
  code: string | null;
  departmentId: string | null;
  active: boolean;
}

export interface TaxSlab {
  minPaisa: number;
  maxPaisa: number | null;
  baseTaxPaisa: number;
  ratePct: number;
}

export interface TaxConfig {
  id: string;
  fiscalYear: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  slabs: TaxSlab[];
  surchargeThresholdPaisa: number;
  surchargeRatePct: number;
  eobiEmployerRatePct: number;
  eobiEmployeeRatePct: number;
  eobiWageBasePaisa: number;
  prorationMethod: string;
  active: boolean;
}

export interface TaxConfigSummary {
  id: string;
  fiscalYear: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  bandCount: number;
}

export interface CurrentFiscalYear {
  fiscalYear: number;
  startsOn: string;
  endsOn: string;
  configured: boolean;
}

export interface PayrollRun {
  id: string;
  periodMonth: number;
  periodYear: number;
  status: PayrollStatus;
  totalGrossPaisa: number;
  totalNetPaisa: number;
  branchId: string | null;
  runBy: string | null;
  approvedBy: string | null;
  paidAt: string | null;
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  basicPaisa: number;
  allowances: Record<string, number>;
  grossPaisa: number;
  deductions: Record<string, number>;
  netPaisa: number;
}

export interface Shift {
  id: string;
  branchId: string;
  name: string;
  roleDesignation: string | null;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
}

export interface ShiftAssignment {
  id: string;
  shiftId: string;
  employeeId: string;
  workDate: string;
}

export interface WeekGrid {
  shifts: Shift[];
  assignments: ShiftAssignment[];
}

export interface AttendancePunch {
  id: string;
  employeeId: string | null;
  punchType: string;
  deviceReportedAt: string;
  serverReceivedAt: string | null;
}

export interface AttendanceSummary {
  employeeId: string;
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  lateMinutes: number;
  earlyMinutes: number;
}

export interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  accrualDaysPerMonth: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  approvedBy: string | null;
  reason: string | null;
}

export interface LeaveBalance {
  leaveTypeId: string;
  periodYear: number;
  balanceDays: number;
}

export interface QuarantinedPunch {
  id: string;
  deviceId: string;
  deviceUserRef: string;
  punchType: string | null;
  deviceReportedAt: string;
  rawLine: string | null;
  status: QuarantineStatus;
  resolvedEmployeeId: string | null;
}

export interface LabourCostByBranch {
  branchId: string;
  periodMonth: number;
  periodYear: number;
  labourCostPaisa: number;
  revenuePaisa: number | null;
  labourCostPct: number | null;
}

export interface CreateShiftInput {
  name: string;
  roleDesignation?: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
}
