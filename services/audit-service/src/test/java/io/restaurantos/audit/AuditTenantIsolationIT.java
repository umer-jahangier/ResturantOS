package io.restaurantos.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.shared.event.EventEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * Proves the audit_events policies actually bind, and — just as importantly — that turning them on
 * did not silently stop the audit log from recording.
 *
 * <h2>Why every isolation assertion here carries its own positive control</h2>
 *
 * <p>An isolation test that passes because everything is hidden is exactly as useless as one that
 * passes because nothing is enforced, and this codebase has produced both in a single day. So no
 * assertion below says only "tenant A saw none of tenant B's rows". Each says, in the same
 * assertion, over the same query: tenant A saw N of its own rows AND zero of tenant B's. If the
 * policy is dropped the foreign count goes up; if the policy is over-broad, or the GUC never
 * reaches the connection, or the schema failed to seed, the own-rows count goes to zero. Only a
 * correct policy satisfies both halves.
 *
 * <h2>Why ingestion is tested here and not left to AuditConsumerIT</h2>
 *
 * <p>{@code AuditConsumerIT} connects as the Testcontainers superuser, which bypasses RLS
 * unconditionally. It therefore cannot detect the failure mode that matters most when enabling a
 * {@code WITH CHECK} policy on this table: a consumer whose connection does not carry
 * {@code app.current_tenant_id} has every INSERT refused, the audit pipeline stops recording, and
 * nothing says so. This project has already watched an audit queue climb to 1,855 undrained
 * messages while audit_events sat frozen. {@link #ingestionStillWritesRowsUnderRls()} drives the
 * real consumer over a connection RLS applies to, so a regression in the GUC ordering inside
 * {@code TenantAwareMessageProcessor} fails a test instead of a compliance audit.
 */
class AuditTenantIsolationIT extends BaseAuditRlsIT {

    private static final String AUTH_EXCHANGE = "auth.topic";
    private static final String ALL_EVENTS_QUEUE = "audit.all-events.queue";

    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private AmqpAdmin amqpAdmin;
    @Autowired private ObjectMapper objectMapper;

    /**
     * A fresh tenant pair per test method, deliberately shadowing the constants in the base class.
     *
     * <p>The obvious alternative — one shared pair plus a {@code DELETE} between tests — is not
     * available on this table and should not be: audit_events is append-only, enforced by the
     * {@code audit_events_immutable} trigger, and the first draft of this class discovered that by
     * being rejected with "audit_events is append-only". Tests do not get a privilege the product
     * denies itself. Randomising the tenants instead means each method's rows are invisible to
     * every other method's assertions — by the very policy under test — so the counts below are
     * exact without anything ever being deleted.
     */
    private final UUID tenantA = UUID.randomUUID();
    private final UUID tenantB = UUID.randomUUID();

    /** The partition the seeded rows land in — named so a test can query it directly. */
    private static String currentPartition() {
        return "audit_events_" + LocalDate.now().toString().substring(0, 7).replace('-', '_');
    }

    @BeforeEach
    void seedBothTenants() throws SQLException {
        amqpAdmin.declareExchange(new TopicExchange(AUTH_EXCHANGE, true, false));
        amqpAdmin.declareQueue(new Queue(ALL_EVENTS_QUEUE, true));
        amqpAdmin.declareBinding(BindingBuilder
                .bind(new Queue(ALL_EVENTS_QUEUE))
                .to(new TopicExchange(AUTH_EXCHANGE))
                .with("#"));

        // Make sure this month has a partition regardless of when the suite is run. 010b
        // pre-created through 2027-01 only, so a run after that would otherwise fail on
        // "no partition of relation audit_events found for row" and look like an RLS problem.
        try (Connection c = asWriter(); Statement s = c.createStatement()) {
            s.execute("SELECT create_audit_partition(DATE '"
                    + LocalDate.now().withDayOfMonth(1) + "')");
        }

        // Seeded as the SUPERUSER, on purpose: a leak needs something to leak, and tenant B's row
        // could not be written over a connection scoped to tenant A.
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            insertCanary(s, tenantA);
            insertCanary(s, tenantA);
            insertCanary(s, tenantB);
        }
    }

    private static void insertCanary(Statement s, UUID tenantId) throws SQLException {
        s.execute("INSERT INTO audit_events (tenant_id, action, resource_type, occurred_at)"
                + " VALUES ('" + tenantId + "', 'ISOLATION_CANARY', 'CANARY', NOW())");
    }

    @Test
    @DisplayName("tenant A sees its own audit rows and none of tenant B's, through audit_events")
    void tenantASeesItsOwnRowsAndNoneOfTenantBs() throws SQLException {
        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            assertNotSuperuserAndOwner(s, "audit_events");
            s.execute("SELECT set_config('app.current_tenant_id', '" + tenantA + "', false)");

            try (ResultSet rs = s.executeQuery(
                    "SELECT count(*) FILTER (WHERE tenant_id <> '" + tenantA + "'), count(*)"
                            + " FROM audit_events WHERE action = 'ISOLATION_CANARY'")) {
                assertThat(rs.next()).isTrue();

                assertThat(rs.getLong(1))
                        .as("""
                            The owning role read another tenant's audit_events. These rows are \
                            every login, void, refund, role change and password reset in the \
                            tenant — the record a compromised account would most want to read and \
                            the one that would show the compromise. FORCE ROW LEVEL SECURITY or \
                            the tenant_isolation policy on audit_events is missing or was removed.""")
                        .isZero();
                assertThat(rs.getLong(2))
                        .as("""
                            POSITIVE CONTROL — tenant A saw NONE of its own two seeded rows. This \
                            assertion exists so that the zero above cannot be satisfied by hiding \
                            everything: a blackout is not isolation, and an isolation test that \
                            passes because the table looks empty proves nothing at all.""")
                        .isEqualTo(2);
            }
        }
    }

    @Test
    @DisplayName("the same holds querying the PARTITION directly, not just through the parent")
    void directPartitionAccessIsAlsoIsolated() throws SQLException {
        // The failure this exists for: a policy on the partitioned parent alone leaves partitions
        // completely unprotected on direct access. Measured on PostgreSQL 18.4 — parent enabled,
        // forced and policied, and `SELECT FROM <partition>` as a NOSUPERUSER owner still returned
        // every tenant's rows. Anything reaching this database outside AuditQueryController can
        // name a partition; pg_dump, a reporting job and a psql session all do it by default.
        String partition = currentPartition();

        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            assertNotSuperuserAndOwner(s, partition);
            s.execute("SELECT set_config('app.current_tenant_id', '" + tenantA + "', false)");

            try (ResultSet rs = s.executeQuery(
                    "SELECT count(*) FILTER (WHERE tenant_id <> '" + tenantA + "'), count(*)"
                            + " FROM " + partition + " WHERE action = 'ISOLATION_CANARY'")) {
                assertThat(rs.next()).isTrue();

                assertThat(rs.getLong(1))
                        .as("""
                            Reading partition %s DIRECTLY returned another tenant's audit rows. \
                            The parent's policy does not cover this path — the partition needs \
                            ENABLE, FORCE and tenant_isolation in its own right, and every future \
                            partition needs them at creation time.""", partition)
                        .isZero();
                assertThat(rs.getLong(2))
                        .as("POSITIVE CONTROL — tenant A must still see its own two rows in %s; "
                                + "a blackout would satisfy the check above without isolating "
                                + "anything", partition)
                        .isEqualTo(2);
            }
        }
    }

    @Test
    @DisplayName("with no tenant on the connection, the policy fails closed")
    void noTenantContextSeesNothing() throws SQLException {
        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            // TenantAwareDataSource writes an EMPTY value rather than leaving the GUC alone, so
            // that a pooled connection never inherits the previous borrower's tenant. The policy
            // has to treat empty as "no tenant", which is what the NULLIF in it is for.
            s.execute("SELECT set_config('app.current_tenant_id', '', false)");

            try (ResultSet rs = s.executeQuery(
                    "SELECT count(*) FROM audit_events WHERE action = 'ISOLATION_CANARY'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1))
                        .as("""
                            An empty app.current_tenant_id must read nothing. If this returns rows \
                            the policy is missing its NULLIF and every connection checked out \
                            before a tenant is known — scheduled sweeps, consumers, actuator — can \
                            read the whole table.""")
                        .isZero();
            }
        }
    }

    @Test
    @DisplayName("an INSERT naming a different tenant than the connection is refused")
    void crossTenantInsertIsRefused() throws SQLException {
        try (Connection c = asAppUser(); Statement s = c.createStatement()) {
            s.execute("SELECT set_config('app.current_tenant_id', '" + tenantA + "', false)");

            // The WITH CHECK half. Without it a caller scoped to tenant A could write rows
            // attributed to tenant B — forging entries into another tenant's audit history, which
            // on an append-only table cannot be corrected afterwards.
            assertThatThrownBy(() -> insertCanary(s, tenantB))
                    .as("writing an audit row for another tenant must violate the policy")
                    .hasMessageContaining("row-level security");

            // POSITIVE CONTROL, same shape as the reads: the policy must not have broken writing.
            try (ResultSet before = s.executeQuery(
                    "SELECT count(*) FROM audit_events WHERE action = 'ISOLATION_CANARY'")) {
                assertThat(before.next()).isTrue();
                assertThat(before.getLong(1)).isEqualTo(2);
            }
            insertCanary(s, tenantA);
            try (ResultSet after = s.executeQuery(
                    "SELECT count(*) FROM audit_events WHERE action = 'ISOLATION_CANARY'")) {
                assertThat(after.next()).isTrue();
                assertThat(after.getLong(1))
                        .as("""
                            POSITIVE CONTROL — an INSERT for the connection's OWN tenant must \
                            still succeed. If this fails the policy has not tightened the audit \
                            log, it has switched it off, and every audited action is being \
                            silently discarded.""")
                        .isEqualTo(3);
            }
        }
    }

    @Test
    @DisplayName("the RabbitMQ ingestion path still writes rows with RLS enabled")
    void ingestionStillWritesRowsUnderRls() throws Exception {
        // End to end over the real consumer: AllEventsConsumer -> TenantAwareMessageProcessor
        // (which sets app.current_tenant_id transaction-locally on the connection already bound to
        // the open transaction) -> AuditIngestionService.ingest(), which joins that same
        // transaction and therefore inserts on that same connection. If that ordering ever breaks,
        // the WITH CHECK policy refuses the row and this test goes red — instead of the audit log
        // going quiet.
        UUID tenant = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId, "USER_LOGIN_SUCCEEDED", tenant, null, Instant.now(),
                UUID.randomUUID(), 1, "auth-service",
                Map.of("userId", UUID.randomUUID().toString()));

        rabbitTemplate.send(AUTH_EXCHANGE, "user.login.succeeded",
                new Message(objectMapper.writeValueAsBytes(envelope)));

        await().atMost(20, SECONDS).untilAsserted(() -> {
            try (Connection c = asOwner(); Statement s = c.createStatement();
                 ResultSet rs = s.executeQuery(
                         "SELECT count(*) FROM audit_events WHERE tenant_id = '" + tenant
                                 + "' AND action = 'USER_LOGIN_SUCCEEDED'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getLong(1))
                        .as("""
                            No audit row was written for a USER_LOGIN_SUCCEEDED event. Enabling \
                            RLS on audit_events has broken INGESTION: the consumer's connection \
                            is not carrying app.current_tenant_id when it inserts, so the WITH \
                            CHECK policy is refusing every write. An audit pipeline that silently \
                            stops recording is worse than one with a missing policy.""")
                        .isEqualTo(1);
            }
        });
    }

    /**
     * Fails loudly if the connection under test is one PostgreSQL would exempt from RLS anyway.
     * Without this, every assertion in the class could pass against a database with no policies at
     * all — which is how a green suite coexisted with 33 inert tables in this product.
     */
    private static void assertNotSuperuserAndOwner(Statement s, String table) throws SQLException {
        try (ResultSet rs = s.executeQuery(
                "SELECT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),"
                        + " pg_get_userbyid(relowner) = current_user"
                        + " FROM pg_class WHERE relname = '" + table + "'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1))
                    .as("the connection asserting isolation must not be SUPERUSER or BYPASSRLS — "
                            + "PostgreSQL would exempt it from every policy and this test would "
                            + "pass against a database with no RLS whatsoever")
                    .isFalse();
            assertThat(rs.getBoolean(2))
                    .as("this role must OWN %s — the owner is exempt from its own policies unless "
                            + "FORCE is set, so ownership is what makes FORCE load-bearing here", table)
                    .isTrue();
        }
    }
}
