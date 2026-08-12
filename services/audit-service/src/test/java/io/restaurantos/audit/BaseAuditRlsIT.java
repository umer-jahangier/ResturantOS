package io.restaurantos.audit;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * The harness that makes row-level security observable in audit-service's tests.
 *
 * <p>Every other integration test in this module connects as the Testcontainers container user,
 * which is a SUPERUSER. PostgreSQL exempts superusers from row-level security unconditionally —
 * FORCE included — so those tests run in a world where policies do not exist. That is not a
 * theoretical concern: it is the exact mechanism by which 33 tables shipped with inert tenant
 * isolation in this product and a green suite reported nothing. A test that asserts isolation
 * over a superuser connection passes identically whether the policy is correct, wrong, or absent.
 *
 * <p>So here the container user ({@code test_owner}) is only a bootstrap role, and
 * {@code db/init-test-db.sql} creates the roles that matter: {@code audit_admin}, which Liquibase
 * and the application both connect as and which therefore OWNS every audit table, and
 * {@code audit_writer}, the production runtime role. Both are {@code NOSUPERUSER NOBYPASSRLS}.
 * Pointing the application at the OWNER is deliberate — the owner is the harder case, because
 * PostgreSQL exempts a table's owner from its own policies unless {@code FORCE} is set. It is the
 * only configuration in which a missing FORCE is visible to a test.
 *
 * @see RlsForcedInvariantIT
 * @see AuditTenantIsolationIT
 */
@SpringBootTest(
        classes = AuditServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
abstract class BaseAuditRlsIT {

    /** Bootstrap/superuser role. Used ONLY for fixture setup that must reach past RLS. */
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
                    .withDatabaseName("audit_db")
                    .withUsername("test_owner")
                    .withPassword("test-owner-pass")
                    .withUrlParam("sslmode", "disable")
                    .withUrlParam("tcpKeepAlive", "true");

    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    /** The unprivileged role Liquibase and the application connect as. It owns the tables. */
    protected static final String APP_USER = "audit_admin";
    protected static final String APP_PASSWORD = "test-admin-pass";

    /** The production runtime role. NOSUPERUSER NOBYPASSRLS, and not the table owner. */
    protected static final String WRITER_USER = "audit_writer";
    protected static final String WRITER_PASSWORD = "test-writer-pass";

    protected static final UUID TENANT_A = UUID.fromString("aa000001-0000-4000-8000-000000000001");
    protected static final UUID TENANT_B = UUID.fromString("bb000001-0000-4000-8000-000000000002");

    static {
        POSTGRES.start();
        RABBIT.start();
        awaitPostgresReady();
        provisionAppRoles();
    }

    /**
     * Creates the unprivileged roles. The whole file goes to the server as one simple-query batch
     * — PostgreSQL accepts semicolon-separated statements that way, which keeps the
     * {@code DO $$ ... $$} block intact instead of being split on its inner semicolons.
     *
     * <p>Run here rather than via {@code withInitScript} because Testcontainers runs an init
     * script during container start with a single connection attempt and no retry, and the first
     * connection to a freshly started container on this Docker setup intermittently dies
     * mid-handshake. Behind {@link #awaitPostgresReady()} that is a non-event.
     */
    private static void provisionAppRoles() {
        String sql;
        try (InputStream in = BaseAuditRlsIT.class.getResourceAsStream("/db/init-test-db.sql")) {
            if (in == null) {
                throw new IllegalStateException("db/init-test-db.sql missing from the test classpath");
            }
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            s.execute(sql);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not create the unprivileged test roles", e);
        }
    }

    private static void awaitPostgresReady() {
        RuntimeException last = null;
        for (int i = 0; i < 60; i++) {
            try (Connection c = DriverManager.getConnection(
                    POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                 Statement s = c.createStatement()) {
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

    /**
     * A connection as the container's SUPERUSER, for fixture setup that has to reach past RLS —
     * seeding another tenant's rows so that a leak has something to leak, and reading ground truth
     * to interpret what the unprivileged role saw.
     *
     * <p>Test code that is ASSERTING isolation must never query through this. Use
     * {@link #asAppUser()}, which is subject to every policy.
     */
    protected static Connection asOwner() throws SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    /** A connection as the NOSUPERUSER NOBYPASSRLS role that OWNS the audit tables. */
    protected static Connection asAppUser() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), APP_USER, APP_PASSWORD);
    }

    /** A connection as the production runtime role — unprivileged and not the owner. */
    protected static Connection asWriter() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), WRITER_USER, WRITER_PASSWORD);
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        // Bind the test server to loopback. Spring Boot otherwise binds the wildcard address, and
        // the macOS Application Firewall filters wildcard-bound sockets: it accepts the connection,
        // writes zero bytes and closes, so requests fail with "header parser received no bytes"
        // and NOTHING is logged server-side. See DEV-STACK-RUNBOOK.md.
        r.add("server.address", () -> "127.0.0.1");

        // NOT POSTGRES.getUsername() — that is the superuser, and RLS does not apply to it.
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", () -> APP_USER);
        r.add("spring.datasource.password", () -> APP_PASSWORD);
        r.add("spring.liquibase.url", POSTGRES::getJdbcUrl);
        r.add("spring.liquibase.user", () -> APP_USER);
        r.add("spring.liquibase.password", () -> APP_PASSWORD);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");

        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        // The listener starts with the context; the queue is declared in @BeforeEach, which runs
        // afterwards. Non-fatal + retry rather than declaring earlier, because in production the
        // queue and its bindings are owned by rabbitmq-definitions.json, not by the consumer.
        r.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");

        r.add("eureka.client.enabled", () -> "false");
        // A dead port on purpose: an IT that does not stand something up must not reach a real one.
        r.add("restaurantos.jwks.uri", () -> "http://localhost:9999/test-jwks-placeholder");
        r.add("restaurantos.internal.secret", () -> "test-internal-secret");
    }
}
