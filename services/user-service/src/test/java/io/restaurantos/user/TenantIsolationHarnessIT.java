package io.restaurantos.user;

import io.restaurantos.shared.tenant.TenantFilterInterceptor;
import io.restaurantos.user.entity.BranchEntity;
import org.hibernate.Session;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The two things that have to be true for any cross-tenant assertion in this module to mean
 * anything, asserted as behaviour rather than as configuration.
 *
 * <p>Both were false at once, which is why a green suite coexisted with a live cross-tenant leak:
 *
 * <ol>
 *   <li><b>RLS was switched off for the test connection.</b> Testcontainers hands back a
 *       superuser, and PostgreSQL exempts superusers from row level security unconditionally —
 *       FORCE included. {@code BranchRlsIT} was asserting isolation against a connection that had
 *       none, and would have passed with every policy dropped. Fixed in {@link BaseUserIT}: the
 *       application connects as {@code user_service}, NOSUPERUSER NOBYPASSRLS.</li>
 *   <li><b>The ORM-layer filter was never enabled on the leaking path.</b> Not — as
 *       {@code BranchRepository} and {@code BranchService} currently state in their javadoc —
 *       because {@code @Filter} fails to propagate from the {@code TenantAuditableEntity} mapped
 *       superclass. {@link #inheritedFilterReachesTheWhereClause()} captures the SQL and shows
 *       that it does propagate. {@code UserWebMvcConfig} registers {@code TenantFilterInterceptor}
 *       for {@code /api/v1/**} only, so {@code /internal/users/**} runs with the filter never
 *       enabled at all.</li>
 * </ol>
 *
 * <p>A test that asserted a datasource username, or that an annotation exists, would pass in both
 * the broken and the fixed world. Each test here queries and counts rows, or reads the SQL that
 * went to the server.
 */
class TenantIsolationHarnessIT extends BaseUserIT {

    /**
     * Hibernate instantiates this from the class name in
     * {@code hibernate.session_factory.statement_inspector}, so the buffer is static — the test
     * never holds the instance. Public and static-nested so the reflective lookup can reach it.
     */
    public static class SqlCapture implements StatementInspector {

        private static final List<String> CAPTURED = new CopyOnWriteArrayList<>();
        private static volatile boolean recording;

        static void start() {
            CAPTURED.clear();
            recording = true;
        }

        static void stop() {
            recording = false;
        }

        static Optional<String> firstContaining(String needle) {
            return CAPTURED.stream().filter(sql -> sql.contains(needle)).findFirst();
        }

        static List<String> captured() {
            return List.copyOf(CAPTURED);
        }

        /**
         * How many times {@code tenant_id} appears in the statement's WHERE clause.
         *
         * <p>Not {@code sql.contains("tenant_id")}: every one of these SELECTs projects
         * {@code tenant_id} as a COLUMN, so that assertion is satisfied by a query with no WHERE
         * clause at all. It was written that way here first and reported green against a
         * completely unfiltered read — the same defect class this file exists to catch, one level
         * up.
         */
        static int tenantPredicateCount(String sql) {
            int where = sql.toLowerCase(java.util.Locale.ROOT).indexOf(" where ");
            if (where < 0) {
                return 0;
            }
            int count = 0;
            for (int i = sql.indexOf("tenant_id", where); i >= 0; i = sql.indexOf("tenant_id", i + 1)) {
                count++;
            }
            return count;
        }

        @Override
        public String inspect(String sql) {
            if (recording) {
                CAPTURED.add(sql);
            }
            return sql;
        }
    }

    @DynamicPropertySource
    static void statementInspector(DynamicPropertyRegistry r) {
        r.add("spring.jpa.properties.hibernate.session_factory.statement_inspector",
            SqlCapture.class::getName);
    }

    @Autowired private TransactionTemplate txTemplate;
    @Autowired private TenantFilterInterceptor tenantFilterInterceptor;

    private String nameA;
    private String nameB;

    /**
     * Seeded as the container owner, deliberately: the rows have to EXIST for a leak to have
     * anything to leak. Everything that ASSERTS below goes through the application's own
     * connection, which is unprivileged.
     */
    @BeforeEach
    void seedOneBranchPerTenant() throws SQLException {
        nameA = "iso-A-" + UUID.randomUUID();
        nameB = "iso-B-" + UUID.randomUUID();
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            s.execute(insert(UUID.randomUUID(), TENANT_A, nameA));
            s.execute(insert(UUID.randomUUID(), TENANT_B, nameB));
        }
    }

    private static String insert(UUID id, UUID tenantId, String name) {
        return "INSERT INTO branches (id, tenant_id, name, is_hq, is_active, timezone,"
            + " created_at, updated_at) VALUES ('" + id + "','" + tenantId + "','" + name
            + "', false, true, 'Asia/Karachi', NOW(), NOW())";
    }

    // ── 1. the harness itself ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("the application's connection is subject to RLS — not a superuser, not BYPASSRLS")
    void applicationRoleIsSubjectToRowLevelSecurity() {
        Object[] role = (Object[]) txTemplate.execute(tx ->
            entityManager.createNativeQuery(
                    "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles"
                        + " WHERE rolname = current_user")
                .getSingleResult());

        assertThat(role[0]).isEqualTo(APP_USER);
        assertThat((Boolean) role[1])
            .as("""
                The integration harness is connecting as a SUPERUSER. PostgreSQL exempts \
                superusers from row level security unconditionally, FORCE included, so every \
                cross-tenant assertion in this module is being made against a connection where \
                isolation is switched off and will pass with the policies dropped. This is how 33 \
                tables shipped with inert RLS and no test noticed. See BaseUserIT — the container \
                user must stay the owner and the application must connect as user_service.""")
            .isFalse();
        assertThat((Boolean) role[2])
            .as("The application role has BYPASSRLS. Policies do not apply to it.")
            .isFalse();
    }

    @Test
    @DisplayName("RLS hides another tenant's branch from the application connection")
    void rlsIsLiveForTheApplicationConnection() {
        Long foreign = txTemplate.execute(tx -> {
            setTransactionTenant(TENANT_A);
            return ((Number) entityManager.createNativeQuery(
                    "SELECT count(*) FROM branches WHERE tenant_id <> :tid")
                .setParameter("tid", TENANT_A)
                .getSingleResult()).longValue();
        });

        assertThat(foreign)
            .as("""
                With the tenant GUC set to A, the application connection can still see rows \
                belonging to other tenants in `branches`. Either the connection is privileged \
                (see applicationRoleIsSubjectToRowLevelSecurity), or FORCE ROW LEVEL SECURITY has \
                been dropped from the table the application itself owns. Both are live \
                cross-tenant reads in production.""")
            .isZero();
    }

    // ── 2. the Hibernate filter, on a real production entity ──────────────────────────

    @Test
    @DisplayName("SQL for BranchEntity carries tenant_id when the tenantFilter is enabled")
    void inheritedFilterReachesTheWhereClause() {
        String sql = txTemplate.execute(tx -> {
            setTransactionTenant(TENANT_A);
            entityManager.unwrap(Session.class)
                .enableFilter("tenantFilter").setParameter("tenantId", TENANT_A);
            SqlCapture.start();
            try {
                entityManager.createQuery("select b from BranchEntity b", BranchEntity.class)
                    .getResultList();
            } finally {
                SqlCapture.stop();
            }
            return SqlCapture.firstContaining("branches").orElseThrow(() -> new AssertionError(
                "No SQL touching branches captured; inspector not installed. Captured: "
                    + SqlCapture.captured()));
        });

        System.out.println("[tenantFilter] BranchEntity:\n    " + sql);

        assertThat(SqlCapture.tenantPredicateCount(sql))
            .as("""
                BranchEntity extends TenantAuditableEntity and declares no @Filter of its own. \
                With the tenantFilter ENABLED, Hibernate emitted a SELECT whose WHERE clause \
                carries no tenant predicate — meaning @Filter on the @MappedSuperclass does not \
                reach the 66 entities that inherit it, and the ORM-layer tenant boundary does not \
                exist anywhere in the fleet. Actual SQL: %s""", sql)
            .isEqualTo(1);
    }

    @Test
    @DisplayName("the enabled filter admits no foreign row, whatever RLS is doing")
    void enabledFilterHidesForeignRowsIndependentlyOfRls() {
        List<BranchEntity> visible = txTemplate.execute(tx -> {
            // Point PostgreSQL at tenant B. RLS will hand B's row over willingly; the only thing
            // that can keep it out of this result is the Hibernate filter.
            setTransactionTenant(TENANT_B);
            entityManager.unwrap(Session.class)
                .enableFilter("tenantFilter").setParameter("tenantId", TENANT_A);
            return entityManager
                .createQuery("select b from BranchEntity b", BranchEntity.class)
                .getResultList();
        });

        // Deliberately "no foreign tenant" rather than "empty". Empty would also hold if the
        // filter did nothing and RLS alone happened to exclude A's rows — the assertion would
        // then be measuring RLS while claiming to measure the filter.
        assertThat(visible).extracting(BranchEntity::getTenantId)
            .as("""
                The tenantFilter was enabled for tenant A and Hibernate returned a row belonging \
                to another tenant. enableFilter() raised nothing and added nothing — the filter is \
                inert for this entity. Every service treats it as the ORM-layer tenant boundary \
                (TenantFilterInterceptor, TenantAwareMessageProcessor, TenantTaskDecorator); if it \
                binds to nothing, RLS is the only boundary left.""")
            .doesNotContain(TENANT_B);
        assertThat(visible).extracting(BranchEntity::getName).doesNotContain(nameB);
    }

    /**
     * CHARACTERIZATION TEST OF A KNOWN, UNFIXED DEFECT. It asserts what the system currently does,
     * which is the wrong thing. <b>When the defect is fixed, this test fails — invert it then.</b>
     * It is here so the fix is provable and so nobody rediscovers this by accident a third time.
     *
     * <p><b>{@code TenantFilterInterceptor} is inert.</b> It runs on every matched request, calls
     * {@code enableFilter("tenantFilter")}, raises nothing, logs nothing — and the queries the
     * request then issues carry no tenant predicate. Every service sets
     * {@code spring.jpa.open-in-view: false}, so there is no request-bound EntityManager;
     * unwrapping the shared proxy outside a transaction yields a TEMPORARY session that Spring
     * closes the moment {@code preHandle} returns. The {@code @Transactional} service call that
     * follows opens a fresh session with no filters enabled.
     *
     * <p>This reproduces the runtime condition rather than describing it: no transaction around
     * {@code preHandle}, a {@code @Transactional} query after it, and only the servlet request and
     * response mocked — neither of which the interceptor reads. Compare
     * {@link #inheritedFilterReachesTheWhereClause()}, which enables the filter INSIDE the
     * transaction and gets the predicate. The annotation works; the delivery mechanism does not.
     *
     * <p>Scope note: the fix is a cross-cutting change (enable the filter when the session is
     * created, not before it exists) affecting all 20 modules, and is reported for its own phase
     * rather than absorbed here.
     */
    @Test
    @DisplayName("KNOWN DEFECT: TenantFilterInterceptor's enableFilter does not reach the request's transaction")
    void interceptorEnabledFilterDoesNotSurviveIntoTheRequestTransaction() throws Exception {
        tenantContext.set(TENANT_A, null, null, null);
        tenantFilterInterceptor.preHandle(
            new MockHttpServletRequest("GET", "/api/v1/branches"), new MockHttpServletResponse(), new Object());

        String sql = txTemplate.execute(tx -> {
            setTransactionTenant(TENANT_A);
            SqlCapture.start();
            try {
                entityManager.createQuery("select b from BranchEntity b", BranchEntity.class)
                    .getResultList();
            } finally {
                SqlCapture.stop();
            }
            return SqlCapture.firstContaining("branches").orElseThrow();
        });

        System.out.println("[interceptor] SQL after preHandle() — note the absent WHERE:\n    " + sql);

        assertThat(SqlCapture.tenantPredicateCount(sql))
            .as("""
                The tenant predicate has APPEARED after a preHandle()-enabled filter. That means \
                the inert-interceptor defect this test characterises has been fixed — which is \
                good news. Invert this assertion to isEqualTo(1), rename it, and delete the \
                KNOWN DEFECT framing. Actual SQL: %s""", sql)
            .isZero();
    }

    @Test
    @DisplayName("the filter admits the caller's own rows — isolation, not a blackout")
    void enabledFilterStillReturnsTheCallersOwnRows() {
        List<BranchEntity> visible = txTemplate.execute(tx -> {
            setTransactionTenant(TENANT_A);
            entityManager.unwrap(Session.class)
                .enableFilter("tenantFilter").setParameter("tenantId", TENANT_A);
            return entityManager
                .createQuery("select b from BranchEntity b", BranchEntity.class)
                .getResultList();
        });

        assertThat(visible).extracting(BranchEntity::getName).contains(nameA);
        assertThat(visible).extracting(BranchEntity::getName).doesNotContain(nameB);
        assertThat(visible).extracting(BranchEntity::getTenantId).containsOnly(TENANT_A);
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────

    /**
     * Transaction-local, so it overrides the session-scoped GUC that TenantAwareDataSource wrote
     * at connection checkout and reverts when this transaction ends.
     */
    private void setTransactionTenant(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
