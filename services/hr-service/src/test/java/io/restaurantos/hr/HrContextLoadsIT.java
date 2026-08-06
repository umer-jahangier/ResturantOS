package io.restaurantos.hr;

import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Smoke test for the hr-service scaffold: proves (a) the Spring context loads — which means Spring
 * Liquibase migrated the full master changelog against the container — and (b) FORCE ROW LEVEL
 * SECURITY + the tenant_isolation policy genuinely isolate rows across tenants.
 */
class HrContextLoadsIT extends HrTestBase {

    @Test
    void contextLoads_andLiquibaseMigratedAllTables() throws Exception {
        try (Connection c = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                     "SELECT count(*) FROM information_schema.tables "
                             + "WHERE table_schema = 'public' AND table_name IN ("
                             + "'employees','tax_config','payroll_runs','payslips','shifts',"
                             + "'shift_assignments','leave_types','leave_requests','leave_balances',"
                             + "'attendance_policies','attendance_devices','attendance_punches',"
                             + "'attendance_quarantine','biometric_templates',"
                             + "'event_outbox','idempotency_keys','processed_events')")) {
            rs.next();
            // 14 tenant tables + 3 shared-infra tables.
            assertThat(rs.getInt(1)).isEqualTo(17);
        }
    }

    @Test
    void forceRls_isolatesRowsAcrossTenants() throws Exception {
        UUID tenantA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();

        // Testcontainers connects the app as a SUPERUSER, which bypasses even FORCE RLS. Drive the
        // isolation check through a dedicated NOSUPERUSER NOBYPASSRLS role so the tenant_isolation
        // policy is genuinely exercised rather than passing on an inert superuser connection.
        final String role = "hr_rls_check";
        final String rolePass = "hr_rls_check_pass";
        try (Connection admin = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement s = admin.createStatement()) {
            s.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '" + role + "') "
                    + "THEN CREATE ROLE " + role + " LOGIN PASSWORD '" + rolePass
                    + "' NOSUPERUSER NOBYPASSRLS; END IF; END $$");
            s.execute("GRANT USAGE ON SCHEMA public TO " + role);
            s.execute("GRANT SELECT, INSERT, DELETE ON leave_types TO " + role);
        }

        try (Connection c = DriverManager.getConnection(postgres.getJdbcUrl(), role, rolePass);
             Statement s = c.createStatement()) {
            // Tenant A: insert one leave type and see it.
            setTenant(s, tenantA);
            s.executeUpdate("INSERT INTO leave_types (tenant_id, name, is_paid) VALUES ('"
                    + tenantA + "', 'Annual', true)");
            assertThat(count(s, "leave_types")).isEqualTo(1);

            // Tenant B: FORCE RLS + tenant_isolation must hide tenant A's row.
            setTenant(s, tenantB);
            assertThat(count(s, "leave_types")).isZero();

            // Back to tenant A: the row is visible again.
            setTenant(s, tenantA);
            assertThat(count(s, "leave_types")).isEqualTo(1);
        }
    }

    private static void setTenant(Statement s, UUID tenant) throws Exception {
        s.execute("SELECT set_config('app.current_tenant_id', '" + tenant + "', false)");
    }

    private static int count(Statement s, String table) throws Exception {
        try (ResultSet rs = s.executeQuery("SELECT count(*) FROM " + table)) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
