package io.restaurantos.audit;

import io.restaurantos.audit.controller.AuditQueryController;
import io.restaurantos.audit.dto.AuditEventView;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.audit.service.AuditIngestionService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The audit log can be READ, by the role that actually runs in production, and only within a tenant.
 *
 * <h2>The test whose absence let the defect ship</h2>
 *
 * <p>{@code audit_writer} — the runtime datasource user — held {@code INSERT} and nothing else, on
 * the parent table and on all thirteen partitions. Verified live on 2026-08-07:
 *
 * <pre>
 * $ psql -U audit_writer -d audit_db -c "SELECT count(*) FROM audit_events;"
 * ERROR:  permission denied for table audit_events
 * </pre>
 *
 * <p>{@code AuditInternalController} — at that point the only way to read the audit log — ran on
 * that same datasource. The read path was therefore broken from the day it was written, and would
 * have failed the first time a compliance query was ever run.
 *
 * <p>{@code AuditImmutabilityIT} could not catch it, for two compounding reasons. It runs the Spring
 * datasource as the Testcontainers <b>superuser</b>, and a superuser bypasses privilege checks
 * entirely — so the grants it was written to verify were not the grants it exercised. And it asserts
 * only the NEGATIVE privileges ({@code UPDATE} false, {@code DELETE} false), never the positive one,
 * so a role with no privileges at all would have passed every one of its assertions.
 *
 * <p>This test fixes both. The Spring datasource connects as a genuine non-superuser
 * {@code audit_writer}; Liquibase keeps the admin connection, exactly as production splits them. So
 * every query below is subject to the real grants, and a missing {@code SELECT} fails here rather
 * than in whichever environment someone first runs an audit query.
 *
 * <h2>Reading is not a mutation</h2>
 *
 * <p>Adding {@code SELECT} does not weaken the append-only guarantee, and this test asserts that
 * rather than asking to be believed. Both layers are checked in the same run as the role that now
 * holds the read: {@link #updateAndDeleteRefusedByPrivilege} for the grants, and
 * {@link #immutabilityTriggerFiresForTheOwnerToo} for the trigger — the latter over an admin
 * connection, because the privilege layer stops {@code audit_writer} before the trigger is reached
 * and a test that only ever runs as {@code audit_writer} cannot tell two layers from one.
 */
@SpringBootTest(
        classes = AuditServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
@DisplayName("audit read path, as the real runtime role")
class AuditReadPathIT {

    private static final String WRITER_USER = "audit_writer";
    private static final String WRITER_PASSWORD = "audit_writer_pass";

    private static final UUID TENANT_A = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000002");

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("audit_db")
                    .withUsername("audit_admin")
                    .withPassword("test-pass");

    /**
     * Creates the non-superuser role BEFORE the Spring context loads.
     *
     * <p>Ordering is load-bearing: SpringExtension builds the context lazily on first injection,
     * which is after user {@code @BeforeAll}. So the role exists by the time Liquibase runs its
     * {@code GRANT ... TO audit_writer} statements and by the time the runtime pool tries to
     * connect as it. Same approach as {@code AuditImmutabilityIT}; the difference is what the
     * datasource does with it afterwards.
     */
    @BeforeAll
    static void createNonSuperuserWriterRole() throws Exception {
        try (Connection conn = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var stmt = conn.createStatement()) {
            stmt.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '%s') THEN
                    CREATE ROLE %s LOGIN PASSWORD '%s';
                  END IF;
                END $$
                """.formatted(WRITER_USER, WRITER_USER, WRITER_PASSWORD));
            // Needed to resolve object names at all. NOSUPERUSER and NOCREATEDB are the defaults
            // and are deliberately not granted — the whole point is that this role is ordinary.
            stmt.execute("GRANT USAGE ON SCHEMA public TO " + WRITER_USER);
        }
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        // Loopback bind: the macOS Application Firewall filters wildcard-bound sockets, accepting
        // the connection and then writing zero bytes, which surfaces as a silent EOF with nothing
        // logged server-side. See DEV-STACK-RUNBOOK.md.
        r.add("server.address", () -> "127.0.0.1");

        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        // THE POINT OF THIS TEST. The runtime pool is the ordinary role, not the superuser, so the
        // grants under test are the grants exercised.
        r.add("spring.datasource.username", () -> WRITER_USER);
        r.add("spring.datasource.password", () -> WRITER_PASSWORD);

        // Liquibase keeps the admin connection — DDL and GRANTs need ownership, and production
        // splits them the same way (AUDIT_DB_ADMIN_USER vs AUDIT_DB_USER).
        r.add("spring.liquibase.url", POSTGRES::getJdbcUrl);
        r.add("spring.liquibase.user", POSTGRES::getUsername);
        r.add("spring.liquibase.password", POSTGRES::getPassword);

        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        r.add("spring.rabbitmq.host", () -> "localhost");
        r.add("spring.rabbitmq.port", () -> "5672");
        r.add("spring.rabbitmq.username", () -> "guest");
        r.add("spring.rabbitmq.password", () -> "guest");
        r.add("restaurantos.jwks.uri", () -> "http://127.0.0.1:1/.well-known/jwks.json");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @Autowired private AuditEventRepository auditEventRepository;
    @Autowired private AuditQueryController auditQueryController;
    @Autowired private TenantContext tenantContext;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private EntityManager entityManager;
    @Autowired private AuditIngestionService auditIngestionService;
    @Autowired private PlatformTransactionManager transactionManager;

    private TransactionTemplate transactionTemplate;

    @BeforeEach
    void prepareTransactionTemplate() {
        transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @AfterEach
    void clearContext() {
        tenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    /**
     * A request from a caller holding {@code audit.log.view}, for tenant {@code tenantId}.
     *
     * <p>Sets both halves of what a real request carries: the Spring authorities that
     * {@code @PreAuthorize} reads, and the {@link TenantContext} that scopes the query. In
     * production {@code JwtAuthenticationFilter} derives both from one verified token, which is why
     * they cannot disagree there.
     */
    private void authenticateWith(UUID tenantId, String... authorities) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("tester", "n/a",
                        java.util.Arrays.stream(authorities)
                                .map(SimpleGrantedAuthority::new)
                                .map(GrantedAuthority.class::cast)
                                .toList()));
        tenantContext.set(tenantId, null, UUID.randomUUID(), null);
    }

    // ── The permission gate ────────────────────────────────────────────────────

    /**
     * The gate is live.
     *
     * <p>Not a formality: audit-service had no {@code @EnableMethodSecurity} before this phase,
     * because it had no user-facing endpoints. Adding a controller without adding that annotation
     * leaves {@code @PreAuthorize} inert — the method runs, the annotation is a comment, and every
     * authenticated token in the tenant reads the whole audit log. The first run of this test class
     * threw {@code AuthenticationCredentialsNotFoundException} from the controller, which is how it
     * was confirmed the advice is actually applied.
     */
    @Test
    @DisplayName("a caller without audit.log.view is refused")
    void permissionIsEnforced() {
        authenticateWith(TENANT_A, "pos.order.void.any", "hr.employee.view");

        assertThatThrownBy(() -> auditQueryController.getEvents(null, null, null, 0, 50))
                .as("holding unrelated permissions must not open the audit log")
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    @DisplayName("an unauthenticated caller is refused")
    void anonymousIsRefused() {
        SecurityContextHolder.clearContext();
        tenantContext.set(TENANT_A, null, UUID.randomUUID(), null);

        assertThatThrownBy(() -> auditQueryController.getEvents(null, null, null, 0, 50))
                .isInstanceOf(AuthenticationException.class);
    }

    // ── The privilege itself ────────────────────────────────────────────────────

    @Test
    @DisplayName("audit_writer holds SELECT — the positive privilege nothing asserted before")
    void auditWriter_holdsSelect() {
        assertThat(hasPrivilege("SELECT"))
                .as("audit_writer must hold SELECT on audit_events. Without it the audit log can "
                        + "be written and never read, which is what shipped: the read API returned "
                        + "'permission denied for table audit_events' for every call ever made.")
                .isTrue();
        assertThat(hasPrivilege("INSERT")).isTrue();
    }

    @Test
    @DisplayName("adding SELECT did not add UPDATE or DELETE")
    void auditWriter_stillCannotUpdateOrDelete() {
        assertThat(hasPrivilege("UPDATE"))
                .as("append-only: no UPDATE, ever").isFalse();
        assertThat(hasPrivilege("DELETE"))
                .as("append-only: no DELETE, ever").isFalse();
    }

    @Test
    @DisplayName("every partition is readable, not just the parent")
    void everyPartitionIsReadable() {
        List<String> unreadable = jdbcTemplate.queryForList("""
                SELECT c.relname
                FROM pg_inherits i
                JOIN pg_class c ON c.oid = i.inhrelid
                JOIN pg_class p ON p.oid = i.inhparent
                WHERE p.relname = 'audit_events'
                  AND NOT has_table_privilege(?, c.oid, 'SELECT')
                """, String.class, WRITER_USER);

        assertThat(unreadable)
                .as("Partitions audit_writer cannot read. A SELECT through the parent needs the "
                        + "privilege on each partition it scans, so one missing grant makes exactly "
                        + "the queries covering that month fail — and the newest partition is the "
                        + "one every recent-events query reads.")
                .isEmpty();
    }

    /**
     * Layer one: the privilege. The runtime role is refused before a trigger is reached.
     *
     * <p>Asserted on the stack trace rather than the message because Spring translates SQLSTATE
     * 42501 to {@code BadSqlGrammarException}, whose own message names only the statement — the
     * "permission denied for table audit_events" lives in the cause. Worth knowing: an assertion on
     * {@code getMessage()} alone passes for any malformed statement, so it would have gone green
     * against a typo instead of against the privilege.
     */
    @Test
    @DisplayName("layer 1 — audit_writer is refused UPDATE and DELETE by privilege")
    void updateAndDeleteRefusedByPrivilege() {
        long id = insertRow(TENANT_A, "USER_LOGIN_SUCCEEDED", null);

        assertThatThrownBy(() ->
                jdbcTemplate.update("UPDATE audit_events SET action = 'tampered' WHERE id = ?", id))
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("permission denied for table audit_events");

        assertThatThrownBy(() ->
                jdbcTemplate.update("DELETE FROM audit_events WHERE id = ?", id))
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("permission denied for table audit_events");
    }

    /**
     * Layer two: the trigger, which fires for ANY role including the table's owner.
     *
     * <p>Exercised over a separate admin connection, because the privilege layer above stops
     * {@code audit_writer} before the trigger is ever evaluated — so a test running only as
     * {@code audit_writer} cannot distinguish "two layers of protection" from "one layer and a
     * trigger that was dropped last week".
     */
    @Test
    @DisplayName("layer 2 — the append-only trigger fires even for the table owner")
    void immutabilityTriggerFiresForTheOwnerToo() throws Exception {
        long id = insertRow(TENANT_A, "TILL_REVIEWED", null);

        try (Connection admin = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var stmt = admin.createStatement()) {

            assertThatThrownBy(() ->
                    stmt.executeUpdate("UPDATE audit_events SET action = 'tampered' WHERE id = " + id))
                    .hasMessageContaining("append-only");

            assertThatThrownBy(() ->
                    stmt.executeUpdate("DELETE FROM audit_events WHERE id = " + id))
                    .hasMessageContaining("append-only");
        }
    }

    // ── The read actually works ────────────────────────────────────────────────

    @Test
    @DisplayName("a SELECT through the repository succeeds as audit_writer")
    void repositoryReadSucceeds() {
        insertRow(TENANT_A, "ORDER_VOIDED", null);

        List<AuditEventEntity> rows = auditEventRepository.findByTenantIdAndOccurredAtBetween(
                TENANT_A, Instant.now().minusSeconds(300), Instant.now().plusSeconds(300),
                org.springframework.data.domain.PageRequest.of(0, 50));

        assertThat(rows)
                .as("This exact call answered 'permission denied for table audit_events' before "
                        + "changeset 013.")
                .isNotEmpty();
    }

    // ── Tenant isolation ───────────────────────────────────────────────────────

    @Test
    @DisplayName("one tenant never reads another's audit events")
    void tenantCannotReadAnotherTenantsEvents() {
        insertRow(TENANT_A, "ROLE_GRANTED", null);
        insertRow(TENANT_B, "ROLE_GRANTED", null);
        insertRow(TENANT_B, "ORDER_REFUNDED", null);

        // A request arriving with tenant A's verified token, held by someone entitled to read.
        authenticateWith(TENANT_A, "audit.log.view");
        List<AuditEventView> asTenantA =
                auditQueryController.getEvents(null, null, null, 0, 200).data();

        assertThat(asTenantA)
                .as("tenant A must see its own rows").isNotEmpty();

        // Nothing of B's is reachable. Asserted by re-reading each returned row's tenant from the
        // database, because the view deliberately does not echo a tenant id back.
        for (AuditEventView view : asTenantA) {
            UUID owner = jdbcTemplate.queryForObject(
                    "SELECT tenant_id FROM audit_events WHERE id = ?", UUID.class, view.id());
            assertThat(owner)
                    .as("row %d leaked across the tenant boundary", view.id())
                    .isEqualTo(TENANT_A);
        }

        tenantContext.clear();
        authenticateWith(TENANT_B, "audit.log.view");
        List<AuditEventView> asTenantB =
                auditQueryController.getEvents(null, null, null, 0, 200).data();
        assertThat(asTenantB).isNotEmpty();
        assertThat(asTenantB).map(AuditEventView::id)
                .as("B's result set must be disjoint from A's")
                .doesNotContainAnyElementsOf(asTenantA.stream().map(AuditEventView::id).toList());
    }

    @Test
    @DisplayName("the read endpoint has no tenant parameter to influence")
    void readEndpointExposesNoTenantParameter() throws NoSuchMethodException {
        Method getEvents = null;
        for (Method m : AuditQueryController.class.getDeclaredMethods()) {
            if (m.getName().equals("getEvents")) {
                getEvents = m;
            }
        }
        assertThat(getEvents).isNotNull();

        for (Parameter p : getEvents.getParameters()) {
            assertThat(p.getType())
                    .as("""
                        %s takes a %s. The tenant MUST come from the verified token and from
                        nothing else — a tenant parameter on a user-facing audit endpoint makes
                        every tenant admin a reader of every other tenant's audit log. The
                        internal endpoint next door takes one, which is defensible only because
                        the secret gating it is held by services rather than users.
                        """.formatted(p.getName(), p.getType().getSimpleName()))
                    .isNotEqualTo(UUID.class);
        }
    }

    // ── Impersonation is attributable ──────────────────────────────────────────

    /**
     * Through {@link AuditIngestionService} rather than a hand-built row, so the assertion covers
     * the wiring under test: envelope field to entity field to column to view. A hand-built row
     * would prove only that the column can hold a UUID.
     */
    @Test
    @DisplayName("an action taken under impersonation records the real platform actor")
    void impersonatedActionRecordsTheRealActor() {
        UUID actedAs = UUID.randomUUID();
        UUID realAdmin = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();

        auditIngestionService.ingest(new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_VOIDED", TENANT_A, null,
                Instant.now(), UUID.randomUUID(), 1, "pos-service",
                Map.of("orderId", orderId.toString()),
                actedAs, realAdmin));

        authenticateWith(TENANT_A, "audit.log.view");
        AuditEventView row = auditQueryController.getEvents("ORDER_VOIDED", null, null, 0, 200)
                .data().stream()
                .filter(v -> orderId.toString().equals(v.resourceId()))
                .findFirst().orElseThrow();

        assertThat(row.userId())
                .as("the account the action was taken AS").isEqualTo(actedAs);
        assertThat(row.impersonatedBy())
                .as("""
                    the REAL human. The gateway has always propagated X-Impersonated-By and no
                    service read it, so a platform administrator could act as any tenant user and
                    the trail named only the user. Attributing the action to the impersonated
                    account alone is the D-34 defect in a different table.
                    """)
                .isEqualTo(realAdmin);
        assertThat(row.resourceType())
                .as("derived from the event type so the log is filterable").isEqualTo("ORDER");
    }

    /**
     * ORDER_VOIDED is the type pos-service actually publishes. The allow-list said VOID_CREATED,
     * so this exact event was dropped on the floor for fourteen phases.
     */
    @Test
    @DisplayName("a void from pos-service is audited under the name pos-service publishes")
    void voidFromPosServiceIsAudited() {
        UUID orderId = UUID.randomUUID();
        assertThat(auditIngestionService.isAuditable(new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_VOIDED", TENANT_A, null, Instant.now(),
                UUID.randomUUID(), 1, "pos-service", Map.of("orderId", orderId.toString()),
                UUID.randomUUID(), null)))
                .as("ORDER_VOIDED must be auditable; VOID_CREATED — the old allow-list entry — is "
                        + "published by nothing and never was")
                .isTrue();

        assertThat(auditIngestionService.isAuditable(new EventEnvelope<>(
                UUID.randomUUID(), "VOID_CREATED", TENANT_A, null, Instant.now(),
                UUID.randomUUID(), 1, "pos-service", Map.of(), null, null)))
                .as("the phantom name must not be reinstated: it would look like coverage and be none")
                .isFalse();
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    private Boolean hasPrivilege(String privilege) {
        return jdbcTemplate.queryForObject(
                "SELECT has_table_privilege(?, 'audit_events', ?)",
                Boolean.class, WRITER_USER, privilege);
    }

    private long insertRow(UUID tenantId, String action, UUID impersonatedBy) {
        return insertRow(tenantId, action, impersonatedBy, UUID.randomUUID());
    }

    /**
     * Written through the entity and {@code persist()}, which is the production INSERT path.
     *
     * <p>Driven by a {@link TransactionTemplate} rather than {@code @Transactional} on this method:
     * Spring's transaction advice is applied by a proxy, and a self-invoked call from inside the
     * test class bypasses the proxy entirely — the annotation is inert and the persist fails with
     * "No EntityManager with actual transaction available". Which is the same class of mistake as
     * an inert {@code @PreAuthorize}, and worth the note: an annotation that silently does nothing
     * is the recurring shape of every defect in this phase.
     */
    private long insertRow(UUID tenantId, String action, UUID impersonatedBy, UUID userId) {
        return transactionTemplate.execute(status -> {
            AuditEventEntity entity = AuditEventEntity.builder()
                    .occurredAt(Instant.now())
                    .tenantId(tenantId)
                    .userId(userId)
                    .impersonatedBy(impersonatedBy)
                    .action(action)
                    .resourceType(action.split("_")[0])
                    .build();
            entityManager.persist(entity);
            entityManager.flush();
            return entity.getId();
        });
    }
}
