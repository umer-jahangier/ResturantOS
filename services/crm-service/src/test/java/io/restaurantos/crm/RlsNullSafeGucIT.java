package io.restaurantos.crm;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Proves changeset 012 actually landed and that it changed exactly one thing.
 *
 * <p><b>The defect.</b> 011 wrote every crm_db policy as
 * {@code tenant_id = current_setting('app.current_tenant_id', true)::uuid}. The GUC's "no tenant"
 * value is the EMPTY STRING — {@code TenantAwareDataSource} writes it on every tenantless checkout
 * and again on every reset at connection close — and {@code ''::uuid} raises
 * {@code invalid input syntax for type uuid}. A legitimately tenantless read (an actuator probe, a
 * platform-scoped query, a RabbitMQ consumer before {@code TenantAwareMessageProcessor} sets
 * context) therefore failed loudly instead of returning nothing. 012 wraps the GUC in
 * {@code NULLIF(..., '')}, so it becomes NULL, {@code tenant_id = NULL} is NULL, and the row is
 * excluded — the same fail-closed outcome, expressed as an answer rather than an exception.
 *
 * <p><b>Why the canary role.</b> Testcontainers hands back a PostgreSQL <i>superuser</i>, and
 * PostgreSQL exempts superusers from row level security unconditionally, FORCE included. Asserting
 * anything about a policy over that connection measures nothing — it is how 33 tables in this
 * repository shipped with inert RLS and a green suite. So these tests create a NOSUPERUSER
 * NOBYPASSRLS role, hand it ownership of the tables (production's shape — crm-service connects as
 * the role that owns them, which is why 011's FORCE is load-bearing), and make every assertion
 * over that connection. Under a superuser the tenantless read below would return every row and the
 * test would fail rather than pass vacuously.
 *
 * <p><b>Both halves, one test.</b> {@link #aTenantScopedReadIsUnaffectedByTheNullSafeCast()}
 * asserts that tenant A still SEES its own customer in the same assertion that proves it cannot
 * see tenant B's. That is the rule {@code KdsAccessIsolationIT}'s javadoc sets out: a check that
 * only ever asserts an absence cannot tell "isolated" from "switched off", and this repository has
 * produced green tests of both kinds on the same day. The positive control is also what proves
 * NULLIF is a no-op for a non-empty GUC.
 *
 * <p><b>Falsification.</b> Revert 012's SQL to the raw cast, or drop its {@code <include>} from
 * db.changelog-master.xml, and {@link #aTenantlessReadAnswersEmptyRatherThanErroring()} errors with
 * {@code invalid input syntax for type uuid: ""}. Both were run; the second is the one that proves
 * the changeset is actually reached, which SQL-level falsification alone does not.
 */
@SpringBootTest(classes = CrmServiceApplication.class)
@Testcontainers
class RlsNullSafeGucIT {

    /** Every table 011 put a tenant_isolation policy on, and 012 re-created. */
    private static final List<String> RLS_TABLES = List.of(
            "customers", "loyalty_accounts", "loyalty_transactions",
            "loyalty_tier_config", "promotions", "customer_feedback");

    private static final String CANARY_ROLE = "rls_canary";
    private static final String CANARY_PASSWORD = "rls_canary_pw";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("crm_db")
                    .withUsername("crm_user")
                    .withPassword("crm_pass");

    @Container
    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:3.12-management"));

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.contexts", () -> "");
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    private static final UUID TENANT_A = UUID.randomUUID();
    private static final UUID TENANT_B = UUID.randomUUID();

    private static Connection asSuperuser() throws SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static Connection asCanary() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), CANARY_ROLE, CANARY_PASSWORD);
    }

    /**
     * Seeds one customer per tenant and hands the six RLS tables to a NOSUPERUSER role. Done as
     * superuser precisely because setup must reach past RLS to plant the row a leak would leak.
     */
    private static void withCanary(CanaryWork work) throws SQLException {
        UUID customerA = UUID.randomUUID();
        UUID customerB = UUID.randomUUID();
        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            dropCanaryRole(s);
            s.execute("CREATE ROLE " + CANARY_ROLE
                    + " LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + CANARY_PASSWORD + "'");
            s.execute("GRANT ALL ON SCHEMA public TO " + CANARY_ROLE);

            s.execute("INSERT INTO customers (id, tenant_id, phone, name) VALUES ('"
                    + customerA + "','" + TENANT_A + "','+923000000001','Tenant A customer')");
            s.execute("INSERT INTO customers (id, tenant_id, phone, name) VALUES ('"
                    + customerB + "','" + TENANT_B + "','+923000000002','Tenant B customer')");

            for (String t : RLS_TABLES) {
                s.execute("ALTER TABLE " + t + " OWNER TO " + CANARY_ROLE);
            }
        }
        try {
            work.run(customerA, customerB);
        } finally {
            try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
                for (String t : RLS_TABLES) {
                    s.execute("ALTER TABLE " + t + " OWNER TO " + POSTGRES.getUsername());
                }
                s.execute("DELETE FROM customers WHERE id IN ('" + customerA + "','" + customerB + "')");
                dropCanaryRole(s);
            }
        }
    }

    /** Called before creating the role too, so it has to tolerate the role not existing. */
    private static void dropCanaryRole(Statement s) throws SQLException {
        s.execute(String.format("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%1$s') THEN
                        DROP OWNED BY %1$s;
                        DROP ROLE %1$s;
                    END IF;
                END $$;
                """, CANARY_ROLE));
    }

    /** Guards against the whole suite passing because RLS was never in the path. */
    private static void assertRlsAppliesTo(Statement s) throws SQLException {
        try (ResultSet rs = s.executeQuery(
                "SELECT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),"
                        + " pg_get_userbyid(relowner) = current_user, relforcerowsecurity"
                        + " FROM pg_class WHERE relname = 'customers'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1))
                    .as("the canary must not be superuser/BYPASSRLS, or nothing below measures anything")
                    .isFalse();
            assertThat(rs.getBoolean(2)).as("the canary must own customers — production's shape").isTrue();
            assertThat(rs.getBoolean(3))
                    .as("customers must be FORCEd, or the owner is exempt from its own policy")
                    .isTrue();
        }
    }

    @Test
    @DisplayName("a tenantless connection reads zero rows from every crm table without throwing")
    void aTenantlessReadAnswersEmptyRatherThanErroring() throws SQLException {
        withCanary((customerA, customerB) -> {
            try (Connection c = asCanary(); Statement s = c.createStatement()) {
                assertRlsAppliesTo(s);

                // Exactly what TenantAwareDataSource writes on a tenantless checkout and on every
                // reset at close: the EMPTY STRING, not an absent GUC.
                s.execute("SELECT set_config('app.current_tenant_id', '', false)");

                for (String table : RLS_TABLES) {
                    long[] visible = new long[1];
                    assertThatCode(() -> visible[0] = countAll(c, table))
                            .as("""
                                Reading %s with an empty tenant GUC threw instead of answering. \
                                The policy is casting the raw GUC — ''::uuid raises "invalid input \
                                syntax for type uuid" — so changeset 012 either did not run or was \
                                reverted. Fail-closed is right; failing LOUDLY on a legitimately \
                                tenantless read is not.""".formatted(table))
                            .doesNotThrowAnyException();
                    assertThat(visible[0])
                            .as("a connection carrying no tenant must see no rows in " + table)
                            .isZero();
                }
            }
        });
    }

    @Test
    @DisplayName("NULLIF changes nothing for a connection that does carry a tenant")
    void aTenantScopedReadIsUnaffectedByTheNullSafeCast() throws SQLException {
        withCanary((customerA, customerB) -> {
            try (Connection c = asCanary(); Statement s = c.createStatement()) {
                assertRlsAppliesTo(s);
                s.execute("SELECT set_config('app.current_tenant_id', '" + TENANT_A + "', false)");

                try (ResultSet rs = s.executeQuery(
                        "SELECT count(*) FILTER (WHERE id = '" + customerA + "'),"
                                + " count(*) FILTER (WHERE id = '" + customerB + "')"
                                + " FROM customers")) {
                    assertThat(rs.next()).isTrue();
                    long own = rs.getLong(1);
                    long foreign = rs.getLong(2);

                    // The positive control and the isolation assertion in one method. Proving a
                    // foreign row is hidden means nothing unless the same connection is shown to
                    // still see its own — otherwise "isolated" and "switched off" look identical,
                    // and NULLIF silently swallowing a valid tenant would read as a pass.
                    assertThat(own)
                            .as("tenant A must still see its own customer — NULLIF must be a no-op "
                                    + "for a non-empty GUC")
                            .isOne();
                    assertThat(foreign)
                            .as("tenant A must not see tenant B's customer")
                            .isZero();
                }
            }
        });
    }

    private static long countAll(Connection c, String table) throws SQLException {
        try (Statement q = c.createStatement();
             ResultSet rs = q.executeQuery("SELECT count(*) FROM " + table)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    @FunctionalInterface
    private interface CanaryWork {
        void run(UUID customerA, UUID customerB) throws SQLException;
    }
}
