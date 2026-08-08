// Layer-2 HR domain models. Clean shapes the UI consumes. Money stays in paisa.

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
  designation: string | null;
  department: string | null;
  employmentType: EmploymentType;
  joinDate: string;
  exitDate: string | null;
  basicSalaryPaisa: number;
  deviceUserRef: string | null;
  active: boolean;
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
