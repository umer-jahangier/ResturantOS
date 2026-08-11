package io.restaurantos.shared.integration;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import io.restaurantos.shared.testsupport.CapturingStatementInspector;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.hibernate.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Answers, from the SQL Hibernate actually emits, whether {@code @Filter} declared on the
 * {@code @MappedSuperclass} {@link TenantAuditableEntity} reaches the 66 entity classes that
 * extend it.
 *
 * <p><b>Why this is not a documentation question.</b> {@code @FilterDef} and {@code @Filter}
 * are two different things bound at two different times. The <i>definition</i> is global — it
 * is collected from any annotated class and registered on the SessionFactory, which is why
 * {@code session.enableFilter("tenantFilter")} succeeds everywhere and nothing in production
 * has ever thrown. The <i>application</i> of a filter is per-entity, and the only way to know
 * whether it happened is to look at the WHERE clause. An enabled filter that binds to nothing
 * is silent by construction: no exception, no warning, no log line — just rows.
 *
 * <p>Three assertions, in increasing order of what they cost to fake:
 * <ol>
 *   <li>the emitted SQL for {@link Widget} (filter inherited only) carries {@code tenant_id};</li>
 *   <li>the emitted SQL for {@link FilterControlWidget} (filter declared on the entity, same
 *       table, same everything else) carries it too — the control that proves the mechanism
 *       works here at all, so a failure of (1) can only be about where the annotation sits;</li>
 *   <li>the behaviour: with the filter enabled for tenant A and PostgreSQL's RLS GUC pointed at
 *       tenant B, a query must return zero rows. This one cannot pass vacuously. If the filter
 *       is inert, tenant B's rows come back, and that is the leak in miniature.</li>
 * </ol>
 */
class TenantFilterPropagationIT extends BaseIntegrationTest {

    private static final UUID TENANT_A = UUID.fromString("a0000000-0000-4000-8000-00000000000a");
    private static final UUID TENANT_B = UUID.fromString("b0000000-0000-4000-8000-00000000000b");

    @PersistenceContext private EntityManager em;
    @Autowired private TransactionTemplate txTemplate;

    /**
     * Registers the inspector by property so Hibernate builds it itself. A new key (rather than
     * an override of one {@link BaseIntegrationTest} already sets) — subclass
     * {@code @DynamicPropertySource} ordering is not something to rely on for a shared key.
     */
    @DynamicPropertySource
    static void statementInspector(DynamicPropertyRegistry r) {
        r.add("spring.jpa.properties.hibernate.session_factory.statement_inspector",
                CapturingStatementInspector.class::getName);
    }

    @BeforeEach
    void seedOneRowPerTenant() {
        txTemplate.executeWithoutResult(tx -> {
            setRlsGuc(TENANT_A);
            em.createNativeQuery("DELETE FROM widgets WHERE name IN ('A-row','B-row')")
                    .executeUpdate();
        });
        insertWidget(TENANT_A, "A-row");
        insertWidget(TENANT_B, "B-row");
    }

    // ── 1. the entity that only INHERITS the filter ────────────────────────────────────

    @Test
    @DisplayName("SQL for an entity that inherits @Filter from the @MappedSuperclass carries tenant_id")
    void inheritedFilterReachesTheWhereClause() {
        String sql = captureSelect(session ->
                em.createQuery("select w from Widget w", Widget.class).getResultList());

        System.out.println("[tenantFilter] Widget (inherits @Filter only):\n    " + sql);

        assertThat(CapturingStatementInspector.tenantPredicateCount(sql))
                .as("""
                    Hibernate emitted this SELECT for an entity extending TenantAuditableEntity \
                    while the tenantFilter was ENABLED, and its WHERE clause carries no tenant \
                    predicate. The @Filter on the @MappedSuperclass is not applied to the \
                    subclass, so every one of the 66 entities that extend it is unfiltered at the \
                    ORM layer and the only thing standing between tenants is PostgreSQL RLS. \
                    Actual SQL: %s""", sql)
                .isEqualTo(1);
    }

    // ── 2. the control: identical entity, filter declared on the entity itself ─────────

    @Test
    @DisplayName("SQL for an entity that DECLARES @Filter itself carries tenant_id (control)")
    void declaredFilterReachesTheWhereClause() {
        String sql = captureSelect(session ->
                em.createQuery("select w from FilterControlWidget w", FilterControlWidget.class)
                        .getResultList());

        System.out.println("[tenantFilter] FilterControlWidget (declares @Filter):\n    " + sql);

        // TWO predicates, not one. This entity has two filter bindings — the one it declares and
        // the one it inherits — and Hibernate applied both. That is the strongest available
        // evidence that the inherited binding is real: a single predicate would have been equally
        // consistent with the inheritance doing nothing and the declared annotation doing all the
        // work, and this rules that out.
        assertThat(CapturingStatementInspector.tenantPredicateCount(sql))
                .as("""
                    The control failed, which invalidates the comparison rather than the codebase: \
                    an entity that declares @Filter on itself AND inherits one produced %d tenant \
                    predicates instead of 2. Something about the harness — the filter is not \
                    enabled on this session, the parameter is unset, the inspector is capturing \
                    the wrong statement — is wrong. Fix this before reading anything into the \
                    inherited-filter result. Actual SQL: %s""",
                        CapturingStatementInspector.tenantPredicateCount(sql), sql)
                .isEqualTo(2);
    }

    // ── 3. the behaviour, which cannot pass vacuously ──────────────────────────────────

    @Test
    @DisplayName("filter enabled for tenant A must hide tenant B's rows even when RLS is aimed at B")
    void enabledFilterHidesForeignRowsIndependentlyOfRls() {
        List<Widget> visible = txTemplate.execute(tx -> {
            // Point PostgreSQL at tenant B. RLS will now happily return B's row; the ONLY thing
            // that can keep it out of this result is the Hibernate filter.
            setRlsGuc(TENANT_B);
            enableTenantFilter(TENANT_A);
            return em.createQuery("select w from Widget w", Widget.class).getResultList();
        });

        // "No foreign tenant", not "empty": empty would also hold if the filter did nothing and
        // RLS alone excluded A's rows, so the assertion would be measuring RLS while claiming to
        // measure the filter.
        assertThat(visible).extracting(Widget::getTenantId)
                .as("""
                    The tenantFilter was enabled for tenant A and Hibernate returned tenant B's \
                    rows anyway. The filter is inert for this entity: enableFilter() succeeded, no \
                    exception was raised, and no predicate was added. Every service relies on this \
                    filter as its ORM-layer tenant boundary (TenantFilterInterceptor, \
                    TenantAwareMessageProcessor, TenantTaskDecorator all enable it per request); \
                    if it binds to nothing, that boundary does not exist and PostgreSQL RLS is \
                    load-bearing alone.""")
                .doesNotContain(TENANT_B);
    }

    /**
     * The harness guard. Everything above is an assertion about the Hibernate filter; this one is
     * about whether PostgreSQL is enforcing anything at all for this connection. Testcontainers
     * hands back a superuser by default, and a superuser is exempt from row level security
     * unconditionally — FORCE included — so a suite that connects as one measures nothing.
     * {@code BaseIntegrationTest} connects as {@code shared_test_user}, NOSUPERUSER NOBYPASSRLS.
     */
    @Test
    @DisplayName("the application's connection is subject to RLS — not a superuser, not BYPASSRLS")
    void applicationRoleIsSubjectToRowLevelSecurity() {
        Object[] role = (Object[]) txTemplate.execute(tx ->
                em.createNativeQuery("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles"
                                + " WHERE rolname = current_user")
                        .getSingleResult());

        assertThat((Boolean) role[1])
                .as("""
                    The integration harness is connecting as SUPERUSER %s. PostgreSQL exempts \
                    superusers from row level security unconditionally, FORCE included, so every \
                    cross-tenant assertion in this module is being made against a connection \
                    where isolation is switched off and would pass with the policies dropped.""",
                        role[0])
                .isFalse();
        assertThat((Boolean) role[2])
                .as("The application role %s has BYPASSRLS. Policies do not apply to it.", role[0])
                .isFalse();
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────

    /**
     * Runs {@code query} inside a transaction with the tenantFilter enabled for {@link #TENANT_A}
     * and the RLS GUC on the same tenant, recording only the statements that query produces.
     */
    private String captureSelect(Consumer<Session> query) {
        txTemplate.executeWithoutResult(tx -> {
            setRlsGuc(TENANT_A);
            Session session = enableTenantFilter(TENANT_A);
            CapturingStatementInspector.start();
            try {
                query.accept(session);
            } finally {
                CapturingStatementInspector.stop();
            }
        });

        return CapturingStatementInspector.firstContaining("widgets")
                .orElseThrow(() -> new AssertionError(
                        "No SQL touching widgets was captured — the StatementInspector is not "
                                + "installed. Captured: " + CapturingStatementInspector.captured()));
    }

    private Session enableTenantFilter(UUID tenantId) {
        Session session = em.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
        return session;
    }

    /** Transaction-local, so it overrides whatever TenantAwareDataSource set at checkout. */
    private void setRlsGuc(UUID tenantId) {
        em.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
    }

    private void insertWidget(UUID tenantId, String name) {
        txTemplate.executeWithoutResult(tx -> {
            setRlsGuc(tenantId);
            em.createNativeQuery(
                            "INSERT INTO widgets (id, tenant_id, name, created_at, updated_at) "
                                    + "VALUES (gen_random_uuid(), :tid, :name, NOW(), NOW())")
                    .setParameter("tid", tenantId)
                    .setParameter("name", name)
                    .executeUpdate();
        });
    }
}
