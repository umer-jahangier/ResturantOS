package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

/**
 * Employee HR-01 acceptance: field-encrypted PII round-trip, cross-tenant RLS isolation, and
 * EMPLOYEE_JOINED/LEFT outbox emission.
 */
class EmployeeIT extends HrTestBase {

    @Autowired EmployeeService employeeService;
    @Autowired EmployeeRepository employeeRepository;
    @Autowired TenantContext tenantContext;

    @Test
    void cnicAndBank_encryptedAtRest_decryptRoundTrips() throws Exception {
        UUID tenantA = UUID.randomUUID();
        String cnicPlain = "4210112345678";
        String bankPlain = "PK36SCBL0000001123456702";
        UUID id;
        EmployeeResponse resp;
        tenantContext.set(tenantA, UUID.randomUUID(), null, null);
        try {
            resp = employeeService.create(new CreateEmployeeRequest(
                    "EMP-ENC", "Ali Khan", null, cnicPlain, bankPlain, "Chef", "Kitchen",
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 20000000L, null));
            id = resp.id();
            // Responses never carry raw PII.
            assertThat(resp.cnicMasked()).isEqualTo("****5678");
            assertThat(resp.bankAccountMasked()).isEqualTo("****6702");
            // Decrypt round-trips through the converter on read.
            EmployeeEntity loaded = employeeRepository.findByIdAndTenantId(id, tenantA).orElseThrow();
            assertThat(loaded.getCnic()).isEqualTo(cnicPlain);
            assertThat(loaded.getBankAccountNo()).isEqualTo(bankPlain);
        } finally {
            tenantContext.clear();
        }

        // The raw bytea column holds ciphertext, never the plaintext CNIC.
        try (Connection c = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             PreparedStatement ps = c.prepareStatement("SELECT cnic FROM employees WHERE id = ?")) {
            ps.setObject(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                assertThat(rs.next()).isTrue();
                byte[] raw = rs.getBytes(1);
                assertThat(raw).isNotNull();
                assertThat(new String(raw, StandardCharsets.UTF_8)).doesNotContain(cnicPlain);
            }
        }
    }

    @Test
    void employees_isolatedAcrossTenants_underForceRls() throws Exception {
        UUID tenantA = UUID.randomUUID();
        tenantContext.set(tenantA, UUID.randomUUID(), null, null);
        try {
            employeeService.create(new CreateEmployeeRequest(
                    "EMP-RLS", "Rls Test", null, null, null, null, null,
                    EmploymentType.CONTRACT, LocalDate.of(2025, 1, 1), 0L, null));
        } finally {
            tenantContext.clear();
        }

        // Superuser (testcontainers) bypasses RLS, so drive the isolation check as a NOSUPERUSER role.
        final String role = "hr_emp_rls_check";
        final String pass = "hr_emp_rls_pass";
        try (Connection admin = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement s = admin.createStatement()) {
            s.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '" + role + "') "
                    + "THEN CREATE ROLE " + role + " LOGIN PASSWORD '" + pass
                    + "' NOSUPERUSER NOBYPASSRLS; END IF; END $$");
            s.execute("GRANT USAGE ON SCHEMA public TO " + role);
            s.execute("GRANT SELECT ON employees TO " + role);
        }
        try (Connection c = DriverManager.getConnection(postgres.getJdbcUrl(), role, pass);
             Statement s = c.createStatement()) {
            s.execute("SELECT set_config('app.current_tenant_id', '" + tenantA + "', false)");
            assertThat(count(s)).isEqualTo(1);
            s.execute("SELECT set_config('app.current_tenant_id', '" + UUID.randomUUID() + "', false)");
            assertThat(count(s)).isZero();
        }
    }

    @Test
    void create_thenDeactivate_publishesJoinedThenLeft() {
        UUID tenantA = UUID.randomUUID();
        tenantContext.set(tenantA, UUID.randomUUID(), null, null);
        try {
            UUID id = employeeService.create(new CreateEmployeeRequest(
                    "EMP-EVT", "Evt Test", null, null, null, null, null,
                    EmploymentType.PART_TIME, LocalDate.of(2025, 1, 1), 0L, null)).id();
            employeeService.deactivate(id);
        } finally {
            tenantContext.clear();
        }

        ArgumentCaptor<OutboxEntry> captor = ArgumentCaptor.forClass(OutboxEntry.class);
        verify(outboxRepository, atLeastOnce()).save(captor.capture());
        List<OutboxEntry> saved = captor.getAllValues();
        assertThat(saved).extracting(OutboxEntry::getEventType).contains("EMPLOYEE_JOINED", "EMPLOYEE_LEFT");
        assertThat(saved).extracting(OutboxEntry::getRoutingKey).contains("hr.employee.joined", "hr.employee.left");
    }

    private static int count(Statement s) throws Exception {
        try (ResultSet rs = s.executeQuery("SELECT count(*) FROM employees")) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
