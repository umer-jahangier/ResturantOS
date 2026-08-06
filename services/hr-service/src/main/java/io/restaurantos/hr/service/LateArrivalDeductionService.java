package io.restaurantos.hr.service;

import io.restaurantos.hr.entity.AttendancePolicyEntity;
import io.restaurantos.hr.entity.AttendancePolicyEntity.DeductionMode;
import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.repository.AttendancePolicyRepository;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.service.AttendanceService.DailyAttendanceSummary;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;

/**
 * Config-driven late-arrival deduction (HR-05 payroll feed). For each work day in the period it
 * derives late minutes vs the assigned shift (11-07), applies the branch's {@code attendance_policies}
 * grace + rate, and totals the {@code late_arrival_paisa} the payslip carries. Never hardcodes the rule.
 */
@Service
public class LateArrivalDeductionService {

    private final AttendanceService attendanceService;
    private final AttendancePolicyRepository policyRepository;
    private final EmployeeRepository employeeRepository;
    private final TenantContext tenantContext;

    public LateArrivalDeductionService(AttendanceService attendanceService,
                                       AttendancePolicyRepository policyRepository,
                                       EmployeeRepository employeeRepository,
                                       TenantContext tenantContext) {
        this.attendanceService = attendanceService;
        this.policyRepository = policyRepository;
        this.employeeRepository = employeeRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional(readOnly = true)
    public long computeMonthlyDeduction(UUID employeeId, int month, int year) {
        UUID tenantId = tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
        EmployeeEntity employee = employeeRepository.findByIdAndTenantId(employeeId, tenantId).orElse(null);
        if (employee == null) {
            return 0L;
        }
        AttendancePolicyEntity policy = policyRepository.findByTenantIdAndBranchId(tenantId, employee.getBranchId())
                .or(() -> policyRepository.findFirstByTenantIdAndBranchIdIsNull(tenantId))
                .orElse(null);
        if (policy == null || policy.getDeductionRatePaisa() <= 0) {
            return 0L; // no policy configured -> no deduction
        }

        long total = 0L;
        YearMonth ym = YearMonth.of(year, month);
        for (int day = 1; day <= ym.lengthOfMonth(); day++) {
            LocalDate date = LocalDate.of(year, month, day);
            DailyAttendanceSummary summary = attendanceService.deriveLateEarly(employeeId, date);
            long lateBeyondGrace = Math.max(0, summary.lateMinutes() - policy.getLateGraceMinutes());
            if (lateBeyondGrace <= 0) {
                continue;
            }
            if (policy.getDeductionMode() == DeductionMode.PER_MINUTE) {
                total += lateBeyondGrace * policy.getDeductionRatePaisa();
            } else { // PER_OCCURRENCE
                total += policy.getDeductionRatePaisa();
            }
        }
        return total;
    }
}
