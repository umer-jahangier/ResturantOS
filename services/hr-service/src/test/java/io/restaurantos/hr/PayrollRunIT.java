package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.entity.PayrollRunEntity;
import io.restaurantos.hr.entity.PayrollRunEntity.Status;
import io.restaurantos.hr.entity.PayslipEntity;
import io.restaurantos.hr.exception.TotpRequiredException;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.hr.service.PayrollRunService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

/**
 * Payroll run lifecycle: compute from the config-driven tax/EOBI, TOTP-gated approval, and the
 * finance-bound PAYROLL_RUN_APPROVED / PAYROLL_RUN_PAID events with verified paisa totals.
 */
class PayrollRunIT extends HrTestBase {

    @Autowired PayrollRunService payrollRunService;
    @Autowired EmployeeService employeeService;
    @Autowired TenantContext tenantContext;

    private void seedTaxConfig(UUID tenant) throws Exception {
        try (Connection c = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement s = c.createStatement()) {
            s.execute("INSERT INTO tax_config (tenant_id, fiscal_year, effective_from, effective_to, "
                    + "income_tax_slabs, surcharge_threshold_paisa, surcharge_rate_pct, "
                    + "eobi_employer_rate_pct, eobi_employee_rate_pct, eobi_wage_base_paisa, proration_method, is_active) "
                    + "VALUES ('" + tenant + "', 2026, DATE '2025-07-01', DATE '2026-06-30', "
                    + "'[{\"minPaisa\":0,\"maxPaisa\":60000000,\"baseTaxPaisa\":0,\"ratePct\":0.0},"
                    + "{\"minPaisa\":60000000,\"maxPaisa\":120000000,\"baseTaxPaisa\":0,\"ratePct\":1.0},"
                    + "{\"minPaisa\":120000000,\"maxPaisa\":220000000,\"baseTaxPaisa\":600000,\"ratePct\":11.0},"
                    + "{\"minPaisa\":220000000,\"maxPaisa\":320000000,\"baseTaxPaisa\":11600000,\"ratePct\":23.0},"
                    + "{\"minPaisa\":320000000,\"maxPaisa\":410000000,\"baseTaxPaisa\":34600000,\"ratePct\":30.0},"
                    + "{\"minPaisa\":410000000,\"maxPaisa\":null,\"baseTaxPaisa\":61600000,\"ratePct\":35.0}]'::jsonb, "
                    + "1000000000, 9.0, 5.0, 1.0, 3700000, 'CALENDAR_DAYS', true)");
        }
    }

    private void seedEmployee(String no, long basicPaisa) {
        employeeService.create(new CreateEmployeeRequest(
                no, "Emp " + no, null, null, null, null, null,
                EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), basicPaisa, null));
    }

    @Test
    void run_calculate_approve_pay_computesAndEmitsEvents() throws Exception {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        seedTaxConfig(tenant);

        tenantContext.set(tenant, branch, user, null);
        try {
            seedEmployee("P-1", 20_000_000L); // Rs 200,000/month
            seedEmployee("P-2", 5_000_000L);  // Rs 50,000/month

            PayrollRunEntity run = payrollRunService.create(8, 2025); // Aug 2025 -> FY2026
            assertThat(run.getStatus()).isEqualTo(Status.DRAFT);

            run = payrollRunService.calculate(run.getId());
            assertThat(run.getStatus()).isEqualTo(Status.CALCULATED);

            List<PayslipEntity> slips = payrollRunService.payslips(run.getId());
            assertThat(slips).hasSize(2);
            for (PayslipEntity slip : slips) {
                assertThat(slip.getDeductionsJson()).containsKeys(
                        "income_tax_paisa", "eobi_employee_paisa", "advances_paisa", "late_arrival_paisa");
                assertThat(slip.getDeductionsJson().get("eobi_employee_paisa")).isEqualTo(37_000L); // 1% of 3.7M
                long totalDeductions = slip.getDeductionsJson().values().stream().mapToLong(Long::longValue).sum();
                assertThat(slip.getNetPaisa()).isEqualTo(slip.getGrossPaisa() - totalDeductions);
                assertThat(slip.getGrossPaisa()).isEqualTo(slip.getBasicPaisa());
            }
            assertThat(run.getTotalGrossPaisa()).isEqualTo(25_000_000L);

            // The component totals PAYROLL_RUN_APPROVED now carries, so finance can credit each
            // withholding to its own statutory account instead of dumping the gross on 2300 and
            // clearing only the net (which left the difference there permanently).
            assertThat(run.getTotalEobiPaisa()).isEqualTo(2 * 37_000L); // fixed wage base, per employee
            assertThat(run.getTotalTaxPaisa()).isPositive();
            assertThat(run.getTotalAdvancesPaisa()).isZero();      // advances are a placeholder today
            assertThat(run.getTotalLateArrivalPaisa()).isZero();   // no attendance policy seeded here
            // THE invariant the journal entry balances on. If this ever fails, finance dead-letters.
            assertThat(run.getTotalNetPaisa() + run.getTotalTaxPaisa()
                    + run.getTotalEobiPaisa() + run.getTotalAdvancesPaisa())
                    .as("net + tax + eobi + advances must equal gross - lateArrival")
                    .isEqualTo(run.getTotalGrossPaisa() - run.getTotalLateArrivalPaisa());

            // Approval is TOTP step-up gated.
            UUID runId = run.getId();
            assertThatThrownBy(() -> payrollRunService.approve(runId, false))
                    .isInstanceOf(TotpRequiredException.class);

            long expectedGross = run.getTotalGrossPaisa();
            long expectedNet = run.getTotalNetPaisa();
            payrollRunService.approve(runId, true);
            payrollRunService.pay(runId);

            ArgumentCaptor<OutboxEntry> captor = ArgumentCaptor.forClass(OutboxEntry.class);
            verify(outboxRepository, atLeastOnce()).save(captor.capture());
            List<OutboxEntry> events = captor.getAllValues();
            assertThat(events).extracting(OutboxEntry::getEventType)
                    .contains("PAYROLL_RUN_APPROVED", "PAYROLL_RUN_PAID");
            assertThat(events).extracting(OutboxEntry::getRoutingKey)
                    .contains("hr.payroll.approved", "hr.payroll.paid");

            // Assert on the SERIALIZED envelope, not on a hand-written map. The 2026-08-02 audit's
            // finding was that producer-side tests which restate the payload in the test's own words
            // prove nothing about what goes on the wire; these are the field names finance binds to.
            String approvedJson = events.stream()
                    .filter(e -> "PAYROLL_RUN_APPROVED".equals(e.getEventType()))
                    .map(OutboxEntry::getEnvelopeJson)
                    .findFirst().orElseThrow();
            assertThat(approvedJson)
                    .contains("\"totalGrossPaisa\":" + expectedGross)
                    .contains("\"totalNetPaisa\":" + expectedNet)
                    .contains("\"totalTaxPaisa\":")
                    .contains("\"totalEobiPaisa\":74000")
                    .contains("\"totalAdvancesPaisa\":0")
                    .contains("\"totalLateArrivalPaisa\":0");
            assertThat(expectedGross).isPositive();
            assertThat(expectedNet).isLessThan(expectedGross);
        } finally {
            tenantContext.clear();
        }
    }
}
