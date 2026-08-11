import type {
  ApiEmployee,
  ApiPayrollRun,
  ApiPayslip,
  ApiShift,
  ApiAssignment,
  ApiWeekGrid,
  ApiPunch,
  ApiAttendanceSummary,
  ApiLeaveType,
  ApiLeaveRequest,
  ApiLeaveBalance,
  ApiQuarantine,
  ApiLabourCostByBranch,
  ApiDepartment,
  ApiDesignation,
  ApiTaxSlab,
  ApiTaxConfig,
  ApiTaxConfigSummary,
  ApiCurrentFiscalYear,
} from "@/lib/api-client/schemas/hr.schema";
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
  Department,
  Designation,
  TaxSlab,
  TaxConfig,
  TaxConfigSummary,
  CurrentFiscalYear,
} from "@/lib/models/hr.model";

// Layer-2 HR adapters: raw API shape -> domain model, normalizing optional/null.

export const adaptEmployee = (a: ApiEmployee): Employee => ({
  id: a.id,
  branchId: a.branchId,
  employeeNo: a.employeeNo,
  fullName: a.fullName,
  userId: a.userId ?? null,
  cnicMasked: a.cnicMasked ?? null,
  bankAccountMasked: a.bankAccountMasked ?? null,
  designationId: a.designationId ?? null,
  designationName: a.designationName ?? null,
  departmentId: a.departmentId ?? null,
  departmentName: a.departmentName ?? null,
  employmentType: a.employmentType,
  joinDate: a.joinDate,
  exitDate: a.exitDate ?? null,
  basicSalaryPaisa: a.basicSalaryPaisa,
  deviceUserRef: a.deviceUserRef ?? null,
  active: a.active,
});

export const adaptDepartment = (a: ApiDepartment): Department => ({
  id: a.id,
  name: a.name,
  code: a.code ?? null,
  active: a.active,
});

export const adaptDesignation = (a: ApiDesignation): Designation => ({
  id: a.id,
  name: a.name,
  code: a.code ?? null,
  departmentId: a.departmentId ?? null,
  active: a.active,
});

export const adaptTaxSlab = (a: ApiTaxSlab): TaxSlab => ({
  minPaisa: a.minPaisa,
  maxPaisa: a.maxPaisa ?? null,
  baseTaxPaisa: a.baseTaxPaisa,
  ratePct: a.ratePct,
});

export const adaptTaxConfig = (a: ApiTaxConfig): TaxConfig => ({
  id: a.id,
  fiscalYear: a.fiscalYear,
  effectiveFrom: a.effectiveFrom,
  effectiveTo: a.effectiveTo ?? null,
  slabs: a.slabs.map(adaptTaxSlab),
  surchargeThresholdPaisa: a.surchargeThresholdPaisa,
  surchargeRatePct: a.surchargeRatePct,
  eobiEmployerRatePct: a.eobiEmployerRatePct,
  eobiEmployeeRatePct: a.eobiEmployeeRatePct,
  eobiWageBasePaisa: a.eobiWageBasePaisa,
  prorationMethod: a.prorationMethod,
  active: a.active,
});

export const adaptTaxConfigSummary = (a: ApiTaxConfigSummary): TaxConfigSummary => ({
  id: a.id,
  fiscalYear: a.fiscalYear,
  effectiveFrom: a.effectiveFrom,
  effectiveTo: a.effectiveTo ?? null,
  active: a.active,
  bandCount: a.bandCount,
});

export const adaptCurrentFiscalYear = (a: ApiCurrentFiscalYear): CurrentFiscalYear => ({
  fiscalYear: a.fiscalYear,
  startsOn: a.startsOn,
  endsOn: a.endsOn,
  configured: a.configured,
});

export const adaptPayrollRun = (a: ApiPayrollRun): PayrollRun => ({
  id: a.id,
  periodMonth: a.periodMonth,
  periodYear: a.periodYear,
  status: a.status,
  totalGrossPaisa: a.totalGrossPaisa,
  totalNetPaisa: a.totalNetPaisa,
  branchId: a.branchId ?? null,
  runBy: a.runBy ?? null,
  approvedBy: a.approvedBy ?? null,
  paidAt: a.paidAt ?? null,
});

export const adaptPayslip = (a: ApiPayslip): Payslip => ({
  id: a.id,
  runId: a.runId,
  employeeId: a.employeeId,
  basicPaisa: a.basicPaisa,
  allowances: a.allowances ?? {},
  grossPaisa: a.grossPaisa,
  deductions: a.deductions ?? {},
  netPaisa: a.netPaisa,
});

export const adaptShift = (a: ApiShift): Shift => ({
  id: a.id,
  branchId: a.branchId,
  name: a.name,
  roleDesignation: a.roleDesignation ?? null,
  startTime: a.startTime,
  endTime: a.endTime,
  daysOfWeek: a.daysOfWeek,
});

export const adaptAssignment = (a: ApiAssignment): ShiftAssignment => ({
  id: a.id,
  shiftId: a.shiftId,
  employeeId: a.employeeId,
  workDate: a.workDate,
});

export const adaptWeekGrid = (a: ApiWeekGrid): WeekGrid => ({
  shifts: a.shifts.map(adaptShift),
  assignments: a.assignments.map(adaptAssignment),
});

export const adaptPunch = (a: ApiPunch): AttendancePunch => ({
  id: a.id,
  employeeId: a.employeeId ?? null,
  punchType: a.punchType,
  deviceReportedAt: a.deviceReportedAt,
  serverReceivedAt: a.serverReceivedAt ?? null,
});

export const adaptAttendanceSummary = (a: ApiAttendanceSummary): AttendanceSummary => ({
  employeeId: a.employeeId,
  date: a.date,
  firstIn: a.firstIn ?? null,
  lastOut: a.lastOut ?? null,
  lateMinutes: a.lateMinutes,
  earlyMinutes: a.earlyMinutes,
});

export const adaptLeaveType = (a: ApiLeaveType): LeaveType => ({
  id: a.id,
  name: a.name,
  paid: a.paid,
  accrualDaysPerMonth: a.accrualDaysPerMonth,
});

export const adaptLeaveRequest = (a: ApiLeaveRequest): LeaveRequest => ({
  id: a.id,
  employeeId: a.employeeId,
  leaveTypeId: a.leaveTypeId,
  startDate: a.startDate,
  endDate: a.endDate,
  status: a.status,
  approvedBy: a.approvedBy ?? null,
  reason: a.reason ?? null,
});

export const adaptLeaveBalance = (a: ApiLeaveBalance): LeaveBalance => ({
  leaveTypeId: a.leaveTypeId,
  periodYear: a.periodYear,
  balanceDays: a.balanceDays,
});

export const adaptQuarantine = (a: ApiQuarantine): QuarantinedPunch => ({
  id: a.id,
  deviceId: a.deviceId,
  deviceUserRef: a.deviceUserRef,
  punchType: a.punchType ?? null,
  deviceReportedAt: a.deviceReportedAt,
  rawLine: a.rawLine ?? null,
  status: a.status,
  resolvedEmployeeId: a.resolvedEmployeeId ?? null,
});

export const adaptLabourCostByBranch = (a: ApiLabourCostByBranch): LabourCostByBranch => ({
  branchId: a.branchId,
  periodMonth: a.periodMonth,
  periodYear: a.periodYear,
  labourCostPaisa: a.labourCostPaisa,
  revenuePaisa: a.revenuePaisa ?? null,
  labourCostPct: a.labourCostPct ?? null,
});
