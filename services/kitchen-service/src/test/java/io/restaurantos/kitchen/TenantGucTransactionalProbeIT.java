package io.restaurantos.kitchen;

import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The same probe as {@link TenantGucProbeIT}, with one difference: this class is
 * {@code @Transactional}, exactly like the seven kitchen IT classes whose inserts PostgreSQL refused
 * once the harness stopped connecting as a superuser.
 *
 * <p>Spring's {@code TransactionalTestExecutionListener} begins the test transaction in
 * {@code beforeTestMethod}, which runs BEFORE {@code @BeforeEach}. So the connection is checked out
 * — and {@code TenantAwareDataSource} reads {@link TenantContext} — while the context is still
 * empty. {@code @BeforeEach} then sets the tenant, so {@code tenantContext.requireTenantId()} inside
 * the service returns it happily.
 *
 * <p><b>This class used to assert the two DISAGREED.</b> It was a known-defect characterisation:
 * the GUC was decided at checkout and never revisited, so the tenant set a moment later never
 * reached the connection, every RLS-protected read matched zero rows and every insert came back
 * {@code SQLSTATE 42501} — while all three of row {@code tenant_id}, thread context and (everyone
 * assumed) connection GUC looked like one value. Which of the three was false: the GUC.
 *
 * <p>{@code TenantAwareDataSource} now re-synchronises both GUCs from {@link TenantContext} when the
 * thread's tenant moves while the connection is still checked out, so the ordering no longer
 * matters. The assertion is inverted accordingly, and this is now a positive contract rather than a
 * characterisation of a defect. The same property is pinned from the other side, against a
 * NOSUPERUSER role with FORCE RLS, by shared-lib's {@code TenantGucFollowsTheContextIT} and
 * {@code ClassLevelTransactionalRlsWriteIT} — both of which go red if the re-sync is removed.
 */
@Transactional
class TenantGucTransactionalProbeIT extends KitchenTestBase {

    @Autowired TenantContext tenantContext;
    @PersistenceContext EntityManager entityManager;

    private UUID tenantId;

    @BeforeEach
    void setTenantTheWayTheSevenClassesDo() {
        tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, UUID.randomUUID(), null, null);
    }

    @Test
    void aTenantSetAfterTheTransactionOpenedStillReachesTheConnection() {
        String guc = (String) entityManager
                .createNativeQuery("SELECT current_setting('app.current_tenant_id', true)")
                .getSingleResult();

        System.out.println("[guc probe @Transactional] context=" + tenantId
                + " connection GUC='" + guc + "'");

        assertThat(tenantContext.getTenantId())
                .as("the ThreadLocal is set — this is what the service sees and why it does not throw")
                .contains(tenantId);

        assertThat(guc)
                .as("""
                    The tenant set in @BeforeEach (%s) did not reach the transaction Spring had \
                    already opened — the connection carries '%s'. Every RLS policy reads the GUC, \
                    not the ThreadLocal, so this service's reads return nothing and its writes come \
                    back SQLSTATE 42501 while the context insists a tenant is present. The \
                    checkout-time GUC is no longer being re-synchronised when the tenant arrives \
                    late (TenantAwareDataSource.TenantGucConnectionHandler).""", tenantId, guc)
                .isEqualTo(tenantId.toString());
    }
}
