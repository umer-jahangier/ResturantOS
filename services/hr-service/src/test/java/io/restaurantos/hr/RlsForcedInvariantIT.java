package io.restaurantos.hr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * hr_db's tenant isolation, proven by a role that cannot bypass it.
 *
 * <h2>Why hr-service needed this and did not have it</h2>
 *
 * <p>pos, kitchen and purchasing each carry an {@code RlsForcedInvariantIT}. hr-service did not,
 * while holding salaries, CNICs and bank account numbers — and 35-02 adds four more tenant tables
 * to the set a broken policy would expose.
 *
 * <h2>Two proofs, because one of them cannot see the defect it guards against</h2>
 *
 * <p>The first test is a schema query: is any RLS-enabled table missing FORCE. That catches the
 * common omission but it reads the database's own belief about itself.
 *
 * <p>The second is behavioural, and it is the one that matters. Testcontainers hands back a
 * SUPERUSER, and a superuser bypasses RLS unconditionally — so an integration test that inserts as
 * tenant A, reads as tenant B and sees nothing has proven nothing at all about the policy; it would
 * report exactly the same green over a policy that had been dropped. This test therefore creates a
 * {@code NOSUPERUSER NOBYPASSRLS} role, hands it OWNERSHIP of the table (which is production's
 * shape — hr_service owns what it queries), and asserts BOTH facts about the role before drawing
 * any conclusion from it. Without those two assertions the test proves nothing, because a superuser
 * connection would trivially "pass" the isolation check by seeing everything.
 *
 * <p>FORCE is the load-bearing word. PostgreSQL exempts a table's owner from its own policies
 * unless FORCE is set, so ENABLE alone gives an inert policy that looks correct in every catalog
 * view.
 */
class RlsForcedInvariantIT extends HrTestBase {

    private static final String CANARY_ROLE = "hr_rls_canary";
    private static final String CANARY_PASSWORD = "hr_rls_canary_pw";

    /** The four tables 35-02 created. Asserted empty below — the behavioural proof of "unseeded". */

    // COUNTS_AFTER_MIGRATION and CONFIG_TABLES live in HrTestBase. They have to: the Postgres
    // container is a static singleton shared by every subclass, so a snapshot taken in THIS class
    // only sees "after migration" when this class happens to run first. In a full-module run the
    // siblings had already inserted 14 departments and 2 designations, and this test read their
    // fixtures as migration-seeded data.

    private Connection asSuperuser() throws SQLException {
        return DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    @Test
    @DisplayName("every RLS-enabled table in hr_db is also FORCE ROW LEVEL SECURITY")
    void everyRlsEnabledTableIsForced() throws SQLException {
        List<String> unforced = new ArrayList<>();
        int rlsEnabledCount;

        try (Connection c = asSuperuser(); Statement s = c.createStatement()) {
            try (ResultSet rs = s.executeQuery("""
                    SELECT c.relname
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'r'
                      AND n.nspname = 'public'
                      AND c.relrowsecurity
                      AND NOT c.relforcerowsecurity
                    ORDER BY c.relname
                    """)) {
                while (rs.next()) {
                    unforced.add(rs.getString(1));
                }
            }
            try (ResultSet rs = s.executeQuery("""
                    SELECT count(*)
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relrowsecurity
                    """)) {
                assertThat(rs.next()).isTrue();
                rlsEnabledCount = rs.getInt(1);
            }
        }

        // The assertion the sibling services' copies of this test lack. Without it, a schema that
        // failed to build at all reports green: zero RLS-enabled tables means zero unforced ones.
        // 011 forces 14 tables and 014 adds 4, so the floor is 18.
        assertThat(rlsEnabledCount)
                .as("the invariant query inspected %d RLS-enabled tables — far too few. The schema "
                        + "did not build, so this test is passing without having checked anything",
                        rlsEnabledCount)
                .isGreaterThanOrEqualTo(18);

        assertThat(unforced)
                .as("""
                    RLS is ENABLED but not FORCED on these tables. hr-service connects as the role \
                    that OWNS them, and PostgreSQL exempts a table's owner from its own policies \
                    unless FORCE is set — so their tenant_isolation policies do nothing and every \
                    tenant can read and write every other tenant's employees, salaries and CNICs. \
                    Add the missing ALTER TABLE ... FORCE ROW LEVEL SECURITY to \
                    011-enable-rls-hr-tables.xml, or to 014-hr-config-tables.xml if the table is \
                    one of the four configuration tables.""")
                .isEmpty();
    }

    /**
     * Nothing was seeded by a migration.
     *
     * <p>The user was explicit that nothing may require a developer to seed, and the inverse holds
     * too: a developer-seeded default is a decision imposed on every tenant that no owner asked
     * for. Reading the changelog cannot establish this — a row could arrive from any of eleven
     * files, or from a context-gated seed changeset. Counting is the only evidence.
     *
     * <p>Ordered first among the data tests so it observes the state immediately after migration.
     */
    @Test
    @DisplayName("after migration the four configuration tables are empty — nothing was seeded")
    void configurationTablesAreEmptyAfterMigration() {
        assertThat(COUNTS_AFTER_MIGRATION)
                .as("the pre-test snapshot did not run")
                .hasSize(CONFIG_TABLES.size());
        assertThat(COUNTS_AFTER_MIGRATION)
                .as("""
                    These tables hold rows straight after migration. A migration-seeded default IS \
                    a developer seeding it — it just hides the fact in version control. The tenant \
                    must create its own lists (D-35-01, D-35-05).""")
                .allSatisfy((table, count) -> assertThat(count).as(table).isZero());
    }

    /**
     * Two departments differing only by case or surrounding whitespace cannot coexist in a tenant.
     *
     * <p>This is the defect the user described as "Waiter", "waiter" and "Wtr". A plain
     * {@code UNIQUE(tenant_id, name)} permits the first two; only the functional index on
     * {@code lower(trim(name))} refuses them.
     */
    @Test
    @DisplayName("case- and whitespace-variant department names collide within one tenant")
    void caseVariantDepartmentNamesCannotCoexist() throws SQLException {
        UUID tenant = UUID.randomUUID();
        try (Connection c = asSuperuser(); Statement s = c.createStatement()) {
            s.execute("INSERT INTO departments (tenant_id, name) VALUES ('" + tenant + "', 'Waiter')");

            for (String variant : List.of("waiter", "WAITER", "  Waiter  ", "Waiter ")) {
                assertThat(catchSqlState(s,
                        "INSERT INTO departments (tenant_id, name) VALUES ('" + tenant + "', '"
                                + variant + "')"))
                        .as("'%s' was accepted alongside 'Waiter' in one tenant — this is exactly "
                                + "the duplicate the phase exists to eliminate", variant)
                        .isEqualTo("23505");
            }

            // A different tenant may of course use the same name.
            s.execute("INSERT INTO departments (tenant_id, name) VALUES ('"
                    + UUID.randomUUID() + "', 'Waiter')");
        }
    }

    /**
     * A salary component cannot be ambiguous about how it is computed, and cannot squat on a
     * deduction key the payroll engine already writes.
     */
    @Test
    @DisplayName("salary_components CHECKs refuse an ambiguous component and a reserved code")
    void salaryComponentConstraintsHold() throws SQLException {
        UUID tenant = UUID.randomUUID();
        try (Connection c = asSuperuser(); Statement s = c.createStatement()) {
            // FIXED with a rate instead of an amount.
            assertThat(catchSqlState(s, insertComponent(tenant, "fuel_1", "FIXED", "NULL", "5.0")))
                    .as("a FIXED component with no amount and a rate must be refused")
                    .isEqualTo("23514");
            // PERCENT_OF_BASIC with an amount instead of a rate.
            assertThat(catchSqlState(s, insertComponent(tenant, "hra_1", "PERCENT_OF_BASIC", "50000", "NULL")))
                    .as("a PERCENT_OF_BASIC component with an amount and no rate must be refused")
                    .isEqualTo("23514");
            // Both populated.
            assertThat(catchSqlState(s, insertComponent(tenant, "both_1", "FIXED", "50000", "5.0")))
                    .as("a component populating both amount and rate must be refused")
                    .isEqualTo("23514");
            // A code the payroll engine already writes into payslips.deductions_json.
            assertThat(catchSqlState(s, insertComponent(tenant, "Income_Tax_Paisa", "FIXED", "50000", "NULL")))
                    .as("a component may not squat on an engine-computed deduction key")
                    .isEqualTo("23514");

            // The well-formed cases are accepted.
            s.execute(insertComponent(tenant, "fuel", "FIXED", "500000", "NULL"));
            s.execute(insertComponent(tenant, "hra", "PERCENT_OF_BASIC", "NULL", "40.0"));
        }
    }

    @Test
    @DisplayName("a NOSUPERUSER table OWNER cannot see another tenant's departments (FORCE is effective)")
    void tableOwnerCannotBypassTenantIsolation() throws SQLException {
        UUID tenantA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();

        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            dropCanaryRole(s);
            s.execute("CREATE ROLE " + CANARY_ROLE
                    + " LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + CANARY_PASSWORD + "'");
            s.execute("GRANT ALL ON SCHEMA public TO " + CANARY_ROLE);

            // Seeded as superuser so RLS cannot interfere with the setup itself.
            s.execute("INSERT INTO departments (tenant_id, name) VALUES ('" + tenantA + "', 'Kitchen A')");
            s.execute("INSERT INTO departments (tenant_id, name) VALUES ('" + tenantB + "', 'Kitchen B')");

            // Production's shape: the querying role OWNS the table it reads.
            s.execute("ALTER TABLE departments OWNER TO " + CANARY_ROLE);
        }

        try {
            try (Connection owner = DriverManager.getConnection(
                    postgres.getJdbcUrl(), CANARY_ROLE, CANARY_PASSWORD);
                 Statement s = owner.createStatement()) {

                // Establish what the canary IS before concluding anything from what it sees.
                // A superuser would pass the isolation check below by seeing everything, so these
                // two assertions are what make the third one mean something.
                try (ResultSet rs = s.executeQuery(
                        "SELECT pg_get_userbyid(relowner) = current_user,"
                                + " (SELECT rolsuper OR rolbypassrls FROM pg_roles"
                                + "  WHERE rolname = current_user)"
                                + " FROM pg_class WHERE relname = 'departments'")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getBoolean(1)).as("canary must own departments").isTrue();
                    assertThat(rs.getBoolean(2)).as("canary must not be superuser/bypassrls").isFalse();
                }

                s.execute("SELECT set_config('app.current_tenant_id', '" + tenantA + "', false)");

                try (ResultSet rs = s.executeQuery(
                        "SELECT count(*) FILTER (WHERE tenant_id <> '" + tenantA + "'), count(*)"
                                + " FROM departments")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getLong(1))
                            .as("""
                                The owning role saw another tenant's departments. FORCE ROW LEVEL \
                                SECURITY is missing or was removed — tenant isolation is inert for \
                                the application and this is a live cross-tenant data leak.""")
                            .isZero();
                    assertThat(rs.getLong(2))
                            .as("tenant A's own row must still be visible — this must distinguish "
                                    + "isolation from a connection that sees nothing at all")
                            .isPositive();
                }
            }
        } finally {
            // The container is static and shared by every hr-service test class in this JVM run.
            // Leaving departments owned by a dropped role would break every later class.
            try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
                s.execute("ALTER TABLE departments OWNER TO " + postgres.getUsername());
                dropCanaryRole(s);
            }
        }
    }

    private static String insertComponent(UUID tenant, String code, String calculation,
                                          String amount, String rate) {
        return "INSERT INTO salary_components (tenant_id, code, name, kind, calculation,"
                + " amount_paisa, rate_pct) VALUES ('" + tenant + "', '" + code + "', '" + code
                + "', 'EARNING', '" + calculation + "', " + amount + ", " + rate + ")";
    }

    /** Runs a statement expected to fail, returning its SQLSTATE (23505 unique, 23514 check). */
    private static String catchSqlState(Statement s, String sql) {
        try {
            s.execute(sql);
            return "(accepted)";
        } catch (SQLException e) {
            return e.getSQLState();
        }
    }

    /**
     * Revoke before dropping.
     *
     * <p>{@code GRANT ALL ON SCHEMA public} records a dependency on the grantee, and PostgreSQL
     * refuses {@code DROP ROLE} while it stands — "cannot be dropped because some objects depend
     * on it". Left unhandled the cleanup throws, the ownership of {@code departments} is never
     * restored, and every later test class sharing this static container fails on a table it
     * cannot write.
     */
    private static void dropCanaryRole(Statement s) throws SQLException {
        try (ResultSet rs = s.executeQuery(
                "SELECT 1 FROM pg_roles WHERE rolname = '" + CANARY_ROLE + "'")) {
            if (!rs.next()) {
                return;
            }
        }
        s.execute("REVOKE ALL ON SCHEMA public FROM " + CANARY_ROLE);
        s.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM " + CANARY_ROLE);
        s.execute("DROP ROLE " + CANARY_ROLE);
    }
}
