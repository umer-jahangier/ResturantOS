package io.restaurantos.shared.integration;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The production shape that produced the report, reduced to one class: a class-level
 * {@code @Transactional} test that sets its tenant in {@code @BeforeEach} and then writes a row
 * carrying that same tenant. Seven kitchen-service IT classes have exactly this shape, and every one
 * of their inserts is refused the moment the harness stops connecting as a superuser — while
 * {@code tenantContext.requireTenantId()} inside the same call happily returns the tenant.
 *
 * <p>Spring's {@code TransactionalTestExecutionListener} opens the transaction in
 * {@code beforeTestMethod}, which JUnit runs BEFORE any {@code @BeforeEach} method. So the
 * connection is checked out — and {@code TenantAwareDataSource} consults {@code TenantContext} —
 * while the context is still empty. The tenant set a moment later never reaches the connection.
 *
 * <p>The tenant here is generated per-test rather than reusing {@link TestFixtures}, so a connection
 * that happened to be carrying the fixture tenant could not make this pass by accident.
 *
 * <p>MEASURED before the fix: context {@code 11111111-…}, row {@code tenant_id 11111111-…}, GUC
 * {@code ''}, {@code SQLSTATE 42501 "new row violates row-level security policy for table widgets"}.
 */
@Transactional
class ClassLevelTransactionalRlsWriteIT extends BaseIntegrationTest {

    @PersistenceContext private EntityManager em;

    private UUID tenantId;

    /** Runs AFTER the transaction has already been opened — that is the whole point. */
    @BeforeEach
    void setTenantTheWayTheKitchenClassesDo() {
        tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, null, null, null);
    }

    @Test
    @DisplayName("an RLS insert succeeds in a class-level @Transactional test")
    void theRowTheContextAndTheGucAllAgree() {
        String guc = (String) em.createNativeQuery(
                "SELECT current_setting('app.current_tenant_id', true)").getSingleResult();

        assertThat(guc)
                .as("""
                    The transaction was opened before @BeforeEach set the tenant, so the connection \
                    carries '%s' while the thread carries %s. Every RLS policy reads the GUC.""",
                        guc, tenantId)
                .isEqualTo(tenantId.toString());

        em.createNativeQuery("INSERT INTO widgets (id, tenant_id, name, created_at, updated_at)"
                        + " VALUES (gen_random_uuid(), :tid, 'class-transactional', NOW(), NOW())")
                .setParameter("tid", tenantId).executeUpdate();
        em.flush();
    }
}
