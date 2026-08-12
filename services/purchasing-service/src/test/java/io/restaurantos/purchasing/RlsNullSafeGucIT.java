package io.restaurantos.purchasing;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Proves V8__rls_policy_null_safe_guc.sql actually landed on all fourteen of purchasing_db's tenant_isolation policies, and
 * that it changed exactly one thing.
 *
 * <p><b>The defect.</b> V1, V2 and V5 wrote their policies as
 * {@code tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID}. The {@code TRUE}
 * handles an UNSET GUC — current_setting returns NULL and the comparison excludes the row — but it
 * does NOT handle an EMPTY STRING, and the empty string is what this runtime actually writes.
 * {@code TenantAwareDataSource.configureTenant} issues
 * {@code set_config('app.current_tenant_id', '', false)} on EVERY checkout where
 * {@code TenantContext} holds no tenant, and {@code ResetGucsOnClose} writes it again when the
 * connection returns to the pool. {@code ''::UUID} raises
 * {@code invalid input syntax for type uuid}, so a legitimately tenantless read — a scheduled
 * sweep, a RabbitMQ consumer before {@code TenantAwareMessageProcessor} sets context, an actuator
 * probe, an {@code /internal/**} handler that resolves its tenant in the controller — failed
 * loudly instead of returning nothing. V8__rls_policy_null_safe_guc.sql wraps the GUC in {@code NULLIF(..., '')} so it
 * becomes NULL: the same fail-closed outcome, expressed as an answer rather than an exception.
 *
 * <p><b>Why this runs Flyway itself instead of booting the application.</b> The service context
 * needs Redis, RabbitMQ, Eureka and a JWKS endpoint, none of which have anything to do with an RLS
 * predicate. Running the REAL {@code db/migration} classpath location is what Spring Boot does, so
 * deleting or renaming V8__rls_policy_null_safe_guc.sql still falsifies this test — the specific Flyway risk worth
 * guarding: a migration that exists on disk but is never reached. That is precisely how auth-service
 * shipped its fix at changeset 087 while a fresh install still died at 040.
 *
 * <p><b>Why the topology is what it is.</b> The container's own user is a PostgreSQL
 * <i>superuser</i>, and PostgreSQL exempts superusers from row level security unconditionally, FORCE
 * included — asserting anything about a policy over that connection measures nothing, and is how 33
 * tables in this repository shipped with inert RLS behind a green suite. So the container user stays
 * the bootstrap/owner role and this test creates {@code purchasing_user}: LOGIN, NOSUPERUSER, NOBYPASSRLS,
 * the same three attributes {@code deploy/init/02-create-roles.sql} gives it in production. Flyway
 * runs as that role, so it OWNS the tables — and because they are FORCEd, the owner is still subject
 * to its own policy.
 */
class RlsNullSafeGucIT {

    /** The unprivileged role the application and Flyway connect as, exactly as in production. */
    private static final String APP_USER = "purchasing_user";
    private static final String APP_PASSWORD = "test-pass";

    private static final UUID TENANT_A = UUID.fromString("aa000001-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("bb000001-0000-4000-8000-000000000002");

    private static final UUID ROW_A = UUID.randomUUID();
    private static final UUID ROW_B = UUID.randomUUID();

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
                    .withDatabaseName("purchasing_db")
                    .withUsername("purchasing_owner")
                    .withPassword("owner-pass")
                    .withUrlParam("sslmode", "disable")
                    .withUrlParam("tcpKeepAlive", "true");

    @BeforeAll
    static void startAndMigrate() throws Exception {
        POSTGRES.start();
        awaitPostgresReady();
        provisionAppRole();
        runFlywayAsAppUser();
        seedOneRowPerTenant();
    }

    @AfterAll
    static void stop() {
        POSTGRES.stop();
    }

    /**
     * Retried rather than done with {@code withInitScript}: the first connection to a freshly
     * started container on this Docker setup intermittently dies mid-handshake, which as an init
     * script is a hard container-start failure and a non-event behind a retry loop.
     */
    private static void awaitPostgresReady() {
        RuntimeException last = null;
        for (int i = 0; i < 60; i++) {
            try (Connection c = asOwner(); Statement s = c.createStatement()) {
                s.execute("SELECT 1");
                return;
            } catch (Exception e) {
                last = new IllegalStateException("Postgres not reachable: " + e.getMessage(), e);
                try {
                    Thread.sleep(500);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(ie);
                }
            }
        }
        throw last;
    }

    private static void provisionAppRole() throws SQLException {
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            s.execute("""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'purchasing_user') THEN
                            CREATE ROLE purchasing_user LOGIN PASSWORD 'test-pass'
                                NOSUPERUSER NOBYPASSRLS;
                        END IF;
                    END
                    $$;
                    GRANT ALL PRIVILEGES ON DATABASE purchasing_db TO purchasing_user;
                    GRANT USAGE, CREATE ON SCHEMA public TO purchasing_user;
                    """);
        }
    }

    /** The real migration set, run the way Spring Boot runs it. */
    private static void runFlywayAsAppUser() {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), APP_USER, APP_PASSWORD)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    /**
     * Seeded as the owner role, which is a superuser here and therefore exempt from RLS — the
     * fixture has to plant the row a leak would leak, and tenant B's row cannot be written through a
     * policy that only admits tenant A.
     */
    private static void seedOneRowPerTenant() throws SQLException {
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            s.execute("INSERT INTO vendors (id, tenant_id, name) VALUES ('" + ROW_A + "','" + TENANT_A + "','Tenant A Vendor')");
            s.execute("INSERT INTO vendors (id, tenant_id, name) VALUES ('" + ROW_B + "','" + TENANT_B + "','Tenant B Vendor')");
        }
    }

    private static Connection asOwner() throws SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static Connection asAppUser() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), APP_USER, APP_PASSWORD);
    }

    /** Guards against the assertions below passing because RLS was never in the path at all. */
    private static void assertRlsAppliesTo(Statement s) throws SQLException {
        try (ResultSet rs = s.executeQuery(
                "SELECT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),"
                        + " pg_get_userbyid(relowner) = current_user, relforcerowsecurity"
                        + " FROM pg_class WHERE relname = 'vendors'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1))
                    .as("purchasing_user must not be superuser/BYPASSRLS, or nothing here measures anything")
                    .isFalse();
            assertThat(rs.getBoolean(2))
                    .as("purchasing_user must own vendors — production's shape")
                    .isTrue();
            assertThat(rs.getBoolean(3))
                    .as("vendors must be FORCEd, or the owner is exempt from its own policy")
                    .isTrue();
        }
    }

    @Test
    @DisplayName("a tenantless connection reads zero vendors rows without throwing")
    void aTenantlessReadAnswersEmptyRatherThanErroring() throws SQLException {
        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            assertRlsAppliesTo(s);

            // Exactly what TenantAwareDataSource writes on a tenantless checkout and on every
            // reset at close: the EMPTY STRING, not an absent GUC.
            s.execute("SELECT set_config('app.current_tenant_id', '', false)");

            long[] visible = new long[1];
            assertThatCode(() -> {
                try (Statement q = c.createStatement();
                     ResultSet rs = q.executeQuery("SELECT count(*) FROM vendors")) {
                    rs.next();
                    visible[0] = rs.getLong(1);
                }
            })
                    .as("""
                        Reading vendors with an empty tenant GUC threw instead of answering. The \
                        policy is casting the raw GUC — ''::UUID raises "invalid input syntax for \
                        type uuid" — so V8__rls_policy_null_safe_guc.sql either did not run or was renamed out of \
                        db/migration. Fail-closed is right; failing LOUDLY on a legitimately \
                        tenantless read is not.""")
                    .doesNotThrowAnyException();

            assertThat(visible[0])
                    .as("a connection carrying no tenant must see no rows — and there ARE two rows "
                            + "in the table, so zero here is exclusion, not an empty fixture")
                    .isZero();
        }
    }

    @Test
    @DisplayName("NULLIF changes nothing for a connection that does carry a tenant")
    void aTenantScopedReadIsUnaffectedByTheNullSafeCast() throws SQLException {
        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            assertRlsAppliesTo(s);
            s.execute("SELECT set_config('app.current_tenant_id', '" + TENANT_A + "', false)");

            try (ResultSet rs = s.executeQuery(
                    "SELECT count(*) FILTER (WHERE id = '" + ROW_A + "'),"
                            + " count(*) FILTER (WHERE id = '" + ROW_B + "')"
                            + " FROM vendors")) {
                assertThat(rs.next()).isTrue();
                long own = rs.getLong(1);
                long foreign = rs.getLong(2);

                // The positive control and the isolation assertion in one method. Proving a foreign
                // row is hidden means nothing unless the same connection is shown to still see its
                // own — otherwise "isolated" and "switched off" look identical, and NULLIF silently
                // swallowing a valid tenant would read as a pass.
                assertThat(own)
                        .as("tenant A must still see its own row — NULLIF must be a no-op for a "
                                + "non-empty GUC")
                        .isOne();
                assertThat(foreign)
                        .as("tenant A must not see tenant B's row")
                        .isZero();
            }
        }
    }

    /**
     * The regression guard with the longest reach. The two tests above pin one table; this one
     * fails the moment ANY policy in purchasing_db reads the tenant GUC without NULLIF — including a table
     * added later by someone copying the original migration's shape.
     */
    @Test
    @DisplayName("no policy in purchasing_db casts the raw tenant GUC")
    void everyTenantPolicyUsesTheNullSafeForm() throws SQLException {
        List<String> offenders = new ArrayList<>();
        try (Connection c = asAppUser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT tablename, policyname, qual
                       FROM pg_policies
                      WHERE schemaname = 'public'
                        AND qual LIKE '%current_tenant_id%'
                        AND qual NOT LIKE '%NULLIF%'
                      ORDER BY tablename, policyname
                     """)) {
            while (rs.next()) {
                offenders.add(rs.getString(1) + "." + rs.getString(2) + " -> " + rs.getString(3));
            }
        }

        assertThat(offenders)
                .as("""
                    These policies cast the tenant GUC directly, so a tenantless connection — which \
                    TenantAwareDataSource creates by writing the EMPTY STRING — raises "invalid \
                    input syntax for type uuid" instead of reading zero rows. Use \
                    NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID.""")
                .isEmpty();
    }

    /**
     * The count is asserted so that "no offenders" cannot be satisfied by a database with no
     * policies at all — the empty-fixture failure mode that makes the test above vacuous.
     */
    @Test
    @DisplayName("all 14 tenant policies exist and are null-safe")
    void theExpectedNumberOfPoliciesIsPresent() throws SQLException {
        try (Connection c = asAppUser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT count(*) FROM pg_policies
                      WHERE schemaname = 'public'
                        AND policyname = 'tenant_isolation'
                        AND qual LIKE '%NULLIF%'
                     """)) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong(1))
                    .as("purchasing_db must carry 14 null-safe tenant_isolation policies; a lower number "
                            + "means a table lost its policy, which is a leak, not a pass")
                    .isEqualTo(14L);
        }
    }
}
