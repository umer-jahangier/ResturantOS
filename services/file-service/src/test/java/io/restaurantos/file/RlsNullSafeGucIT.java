package io.restaurantos.file;

import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Proves changeset 012 actually landed on file_metadata and that it changed exactly one thing.
 *
 * <p><b>The defect.</b> 011 wrote the policy as
 * {@code tenant_id = current_setting('app.current_tenant_id', true)::uuid}. The GUC's "no tenant"
 * value is the EMPTY STRING — {@code TenantAwareDataSource} writes it on every tenantless checkout
 * and again on every reset at connection close — and {@code ''::uuid} raises
 * {@code invalid input syntax for type uuid}. A legitimately tenantless read (an actuator probe, a
 * platform-scoped query, a job that has not adopted a tenant) therefore failed loudly instead of
 * returning nothing. 012 wraps the GUC in {@code NULLIF(..., '')}, so it becomes NULL,
 * {@code tenant_id = NULL} is NULL, and the row is excluded — the same fail-closed outcome,
 * expressed as an answer rather than an exception.
 *
 * <p><b>Why this runs Liquibase itself instead of booting the application.</b> file-service's
 * context needs MinIO, Redis, RabbitMQ, Eureka and a JWKS endpoint, none of which have anything to
 * do with an RLS predicate; standing them all up to read one {@code count(*)} would make this test
 * slow and flaky for no gain in what it measures. {@link SpringLiquibase} against the REAL
 * {@code db.changelog-master.xml} is exactly what Spring Boot itself runs, so removing 012's
 * {@code <include>} from that file still falsifies this test — which is the specific Liquibase risk
 * worth guarding: a changeset that exists but is never reached.
 *
 * <p><b>Why the topology is what it is.</b> The container's own user is a PostgreSQL
 * <i>superuser</i>, and PostgreSQL exempts superusers from row level security unconditionally,
 * FORCE included — asserting anything about a policy over that connection measures nothing, and is
 * how 33 tables in this repository shipped with inert RLS behind a green suite. So the container
 * user stays the bootstrap/owner role and this test creates {@code file_service}: LOGIN,
 * NOSUPERUSER, NOBYPASSRLS, the same three attributes {@code deploy/init/02-create-roles.sql} gives
 * it in production. Liquibase runs as that role, so it OWNS {@code file_metadata} and 011's
 * {@code GRANT ... TO file_service} resolves — and because the table is FORCEd, the owner is still
 * subject to its own policy. Every assertion below is made over that connection.
 *
 * <p><b>Both halves, one test.</b> {@link #aTenantScopedReadIsUnaffectedByTheNullSafeCast()}
 * asserts that tenant A still SEES its own file in the same assertion that proves it cannot see
 * tenant B's — the rule {@code KdsAccessIsolationIT}'s javadoc sets out. A check that only asserts
 * an absence cannot tell "isolated" from "switched off", and this repository has produced green
 * tests of both kinds on the same day. The positive control is also what proves NULLIF is a no-op
 * for a non-empty GUC.
 */
class RlsNullSafeGucIT {

    /** The unprivileged role the application and Liquibase connect as, exactly as in production. */
    private static final String APP_USER = "file_service";
    private static final String APP_PASSWORD = "test-pass";

    private static final UUID TENANT_A = UUID.fromString("aa000001-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("bb000001-0000-4000-8000-000000000002");

    private static final UUID FILE_A = UUID.randomUUID();
    private static final UUID FILE_B = UUID.randomUUID();

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
                    .withDatabaseName("file_db")
                    .withUsername("file_owner")
                    .withPassword("file-owner-pass")
                    .withUrlParam("sslmode", "disable")
                    .withUrlParam("tcpKeepAlive", "true");

    @BeforeAll
    static void startAndMigrate() throws Exception {
        POSTGRES.start();
        awaitPostgresReady();
        provisionAppRole();
        runLiquibaseAsAppUser();
        seedOneFilePerTenant();
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
                        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'file_service') THEN
                            CREATE ROLE file_service LOGIN PASSWORD 'test-pass'
                                NOSUPERUSER NOBYPASSRLS;
                        END IF;
                    END
                    $$;
                    GRANT ALL PRIVILEGES ON DATABASE file_db TO file_service;
                    GRANT USAGE, CREATE ON SCHEMA public TO file_service;
                    """);
        }
    }

    /** The real master changelog, run the way Spring Boot runs it. */
    private static void runLiquibaseAsAppUser() throws Exception {
        DriverManagerDataSource ds = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), APP_USER, APP_PASSWORD);
        ds.setDriverClassName("org.postgresql.Driver");

        SpringLiquibase liquibase = new SpringLiquibase();
        liquibase.setDataSource(ds);
        liquibase.setChangeLog("classpath:db/changelog/db.changelog-master.xml");
        liquibase.setResourceLoader(new DefaultResourceLoader());
        liquibase.setContexts("");
        liquibase.afterPropertiesSet();
    }

    /**
     * Seeded as the owner role with RLS deliberately bypassed for the duration of the INSERT — the
     * fixture has to plant the row a leak would leak, and tenant B's row cannot be written through
     * a policy that only admits tenant B.
     */
    private static void seedOneFilePerTenant() throws SQLException {
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            insertFile(s, FILE_A, TENANT_A, "tenant-a.png");
            insertFile(s, FILE_B, TENANT_B, "tenant-b.png");
        }
    }

    private static void insertFile(Statement s, UUID id, UUID tenant, String name)
            throws SQLException {
        s.execute("INSERT INTO file_metadata"
                + " (id, tenant_id, uploaded_by, object_key, original_filename, content_type,"
                + "  size_bytes)"
                + " VALUES ('" + id + "','" + tenant + "','" + UUID.randomUUID() + "',"
                + " '" + tenant + "/" + name + "','" + name + "','image/png',1024)");
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
                        + " FROM pg_class WHERE relname = 'file_metadata'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1))
                    .as("file_service must not be superuser/BYPASSRLS, or nothing here measures anything")
                    .isFalse();
            assertThat(rs.getBoolean(2))
                    .as("file_service must own file_metadata — production's shape")
                    .isTrue();
            assertThat(rs.getBoolean(3))
                    .as("file_metadata must be FORCEd, or the owner is exempt from its own policy")
                    .isTrue();
        }
    }

    @Test
    @DisplayName("a tenantless connection reads zero file_metadata rows without throwing")
    void aTenantlessReadAnswersEmptyRatherThanErroring() throws SQLException {
        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            assertRlsAppliesTo(s);

            // Exactly what TenantAwareDataSource writes on a tenantless checkout and on every
            // reset at close: the EMPTY STRING, not an absent GUC.
            s.execute("SELECT set_config('app.current_tenant_id', '', false)");

            long[] visible = new long[1];
            assertThatCode(() -> {
                try (Statement q = c.createStatement();
                     ResultSet rs = q.executeQuery("SELECT count(*) FROM file_metadata")) {
                    rs.next();
                    visible[0] = rs.getLong(1);
                }
            })
                    .as("""
                        Reading file_metadata with an empty tenant GUC threw instead of answering. \
                        The policy is casting the raw GUC — ''::uuid raises "invalid input syntax \
                        for type uuid" — so changeset 012 either did not run or was reverted. \
                        Fail-closed is right; failing LOUDLY on a legitimately tenantless read is \
                        not.""")
                    .doesNotThrowAnyException();

            assertThat(visible[0])
                    .as("a connection carrying no tenant must see no files — and there ARE two "
                            + "rows in the table, so zero here is exclusion, not an empty fixture")
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
                    "SELECT count(*) FILTER (WHERE id = '" + FILE_A + "'),"
                            + " count(*) FILTER (WHERE id = '" + FILE_B + "')"
                            + " FROM file_metadata")) {
                assertThat(rs.next()).isTrue();
                long own = rs.getLong(1);
                long foreign = rs.getLong(2);

                // The positive control and the isolation assertion in one method. Proving a foreign
                // row is hidden means nothing unless the same connection is shown to still see its
                // own — otherwise "isolated" and "switched off" look identical, and NULLIF
                // silently swallowing a valid tenant would read as a pass.
                assertThat(own)
                        .as("tenant A must still see its own file — NULLIF must be a no-op for a "
                                + "non-empty GUC")
                        .isOne();
                assertThat(foreign)
                        .as("tenant A must not see tenant B's file")
                        .isZero();
            }
        }
    }
}
