package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.entity.AttendancePolicyEntity;
import io.restaurantos.hr.entity.AttendancePolicyEntity.DeductionMode;
import io.restaurantos.hr.entity.AttendancePunchEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.entity.PayrollRunEntity;
import io.restaurantos.hr.entity.PayslipEntity;
import io.restaurantos.hr.feign.PosRevenueClient;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.hr.repository.AttendancePolicyRepository;
import io.restaurantos.hr.repository.AttendancePunchRepository;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.hr.service.LabourCostService;
import io.restaurantos.hr.service.LabourCostService.LabourCostByBranch;
import io.restaurantos.hr.service.PayrollRunService;
import io.restaurantos.hr.service.ShiftService;
import io.restaurantos.hr.service.ShiftService.AssignRequest;
import io.restaurantos.hr.service.ShiftService.CreateShiftRequest;
import io.restaurantos.hr.service.ShiftService.ShiftResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/** Late-arrival deduction feeding payroll, and labour-cost % against a mocked revenue source. */
class LabourCostIT extends HrTestBase {

    @MockitoBean PosRevenueClient posRevenueClient;

    @Autowired PayrollRunService payrollRunService;
    @Autowired EmployeeService employeeService;
    @Autowired ShiftService shiftService;
    @Autowired LabourCostService labourCostService;
    @Autowired AttendancePolicyRepository policyRepository;
    @Autowired AttendanceDeviceRepository deviceRepository;
    @Autowired AttendancePunchRepository punchRepository;
    @Autowired TenantContext tenantContext;

    private void seedTaxConfigFy2026(UUID tenant) throws Exception {
        try (Connection c = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement s = c.createStatement()) {
            s.execute("INSERT INTO tax_config (tenant_id, fiscal_year, effective_from, effective_to, "
                    + "income_tax_slabs, surcharge_threshold_paisa, surcharge_rate_pct, eobi_employer_rate_pct, "
                    + "eobi_employee_rate_pct, eobi_wage_base_paisa, proration_method, is_active) VALUES ('"
                    + tenant + "', 2026, DATE '2025-07-01', DATE '2026-06-30', "
                    + "'[{\"minPaisa\":0,\"maxPaisa\":60000000,\"baseTaxPaisa\":0,\"ratePct\":0.0},"
                    + "{\"minPaisa\":60000000,\"maxPaisa\":120000000,\"baseTaxPaisa\":0,\"ratePct\":1.0},"
                    + "{\"minPaisa\":120000000,\"maxPaisa\":null,\"baseTaxPaisa\":600000,\"ratePct\":11.0}]'::jsonb, "
                    + "1000000000, 9.0, 5.0, 1.0, 3700000, 'CALENDAR_DAYS', true)");
        }
    }

    @Test
    void lateArrivalDeduction_feedsPayslip() throws Exception {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        seedTaxConfigFy2026(tenant);
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            UUID empId = employeeService.create(new CreateEmployeeRequest(
                    "EMP-LC", "LC Emp", null, null, null, null, null,
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 5_000_000L, null)).id();

            // PER_MINUTE 1000 paisa/min, no grace.
            AttendancePolicyEntity policy = new AttendancePolicyEntity();
            policy.setTenantId(tenant);
            policy.setBranchId(branch);
            policy.setLateGraceMinutes(0);
            policy.setDeductionMode(DeductionMode.PER_MINUTE);
            policy.setDeductionRatePaisa(1000L);
            policyRepository.save(policy);

            ShiftResponse shift = shiftService.create(new CreateShiftRequest(
                    "Morning", "Waiter", LocalTime.of(9, 0), LocalTime.of(17, 0), List.of(1, 2, 3, 4, 5)));
            LocalDate day = LocalDate.of(2026, 6, 15);
            shiftService.assign(new AssignRequest(shift.id(), empId, day));

            AttendanceDeviceEntity dev = new AttendanceDeviceEntity();
            dev.setTenantId(tenant);
            dev.setBranchId(branch);
            dev.setSerialNo("SN-lc-" + UUID.randomUUID());
            dev.setConnectionMode(ConnectionMode.MANUAL);
            dev.setDeviceToken("x");
            dev.setActive(true);
            dev = deviceRepository.save(dev);

            AttendancePunchEntity punch = new AttendancePunchEntity();
            punch.setTenantId(tenant);
            punch.setBranchId(branch);
            punch.setDeviceId(dev.getId());
            punch.setEmployeeId(empId);
            punch.setDeviceUserRef("MANUAL:" + empId);
            punch.setPunchType(PunchType.IN);
            punch.setDeviceReportedAt(day.atTime(9, 30).atZone(ZoneId.systemDefault()).toInstant());
            punch.setServerReceivedAt(Instant.now());
            punchRepository.save(punch);

            PayrollRunEntity run = payrollRunService.create(6, 2026);
            run = payrollRunService.calculate(run.getId());

            List<PayslipEntity> slips = payrollRunService.payslips(run.getId());
            PayslipEntity slip = slips.stream().filter(p -> p.getEmployeeId().equals(empId)).findFirst().orElseThrow();
            // 30 min late * 1000 paisa/min = 30,000.
            assertThat(slip.getDeductionsJson().get("late_arrival_paisa")).isEqualTo(30_000L);
            // gross 5,000,000 - tax 0 - eobi 37,000 - late 30,000 = 4,933,000.
            assertThat(slip.getNetPaisa()).isEqualTo(4_933_000L);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void labourCostPct_computedAgainstMockedRevenue() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        when(posRevenueClient.revenueForBranch(any(), any(), any())).thenReturn(Optional.of(10_000_000L));
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            employeeService.create(new CreateEmployeeRequest("LC-1", "One", null, null, null, null, null,
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 2_000_000L, null));
            employeeService.create(new CreateEmployeeRequest("LC-2", "Two", null, null, null, null, null,
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 3_000_000L, null));

            LabourCostByBranch result = labourCostService.labourCostByBranch(branch, 6, 2026);
            assertThat(result.labourCostPaisa()).isEqualTo(5_000_000L);
            assertThat(result.revenuePaisa()).isEqualTo(10_000_000L);
            // 5,000,000 / 10,000,000 * 100 = 50.0
            assertThat(result.labourCostPct()).isEqualTo(50.0);
        } finally {
            tenantContext.clear();
        }
    }
}
