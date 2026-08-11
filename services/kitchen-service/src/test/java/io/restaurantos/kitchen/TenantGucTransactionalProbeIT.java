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
 * {@code @Transactional}, exactly like the seven kitchen IT classes whose inserts PostgreSQL
 * refuses once the harness stops connecting as a superuser.
 *
 * <p>Spring's {@code TransactionalTestExecutionListener} begins the test transaction in
 * {@code beforeTestMethod}, which runs BEFORE {@code @BeforeEach}. So the connection is checked
 * out — and {@code TenantAwareDataSource} reads {@link TenantContext} to set
 * {@code app.current_tenant_id} — while the context is still empty. {@code @BeforeEach} then sets
 * the tenant on the ThreadLocal, so {@code tenantContext.requireTenantId()} inside the service
 * returns it happily; but the connection that service is writing through was configured before
 * that and carries no tenant. Every RLS policy reads the GUC, not the ThreadLocal.
 *
 * <p>That is the whole contradiction: row tenant_id, thread context and connection GUC are NOT the
 * same value, because the GUC was decided earlier than the other two.
 */
@Transactional
class TenantGucTransactionalProbeIT extends KitchenTestBase {

    @Autowired TenantContext tenantContext;
    @PersistenceContext EntityManager entityManager;

    private UUID tenantId;

    @BeforeEach
    void setTenantTheWayTheFailingTestsDo() {
        tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, UUID.randomUUID(), null, null);
    }

    @Test
    void aClassLevelTransactionalTestChecksOutItsConnectionBeforeTheTenantIsSet() {
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
                    KNOWN DEFECT, characterised. The connection carries GUC '%s' while the thread \
                    carries tenant %s. Spring opened this transaction before @BeforeEach ran, so \
                    TenantAwareDataSource had nothing to write. Under the superuser harness this \
                    was invisible — RLS did not apply — which is why seven IT classes here are \
                    written this way. Under a NOSUPERUSER role every write in them is refused and \
                    every read returns nothing.

                    When this is fixed — by setting the tenant before the transaction opens \
                    (@BeforeTransaction), or by dropping class-level @Transactional in favour of \
                    per-call transactions — this assertion flips. Invert it then.""",
                        guc, tenantId)
                // "Not this tenant" rather than "empty", because it is not reliably empty. Run
                // alone the GUC is NULL; run in a suite it is a PREVIOUS test's tenant. That is
                // the same mechanism a second time: TenantAwareDataSource only proxies — and so
                // only RESETS on close — a connection it configured, so a checkout made with an
                // empty context both writes no GUC and leaves whatever the last tenant-bearing
                // checkout wrote. Asserting isNullOrEmpty() here passed alone and failed in the
                // suite; this assertion holds either way, which is the property that matters.
                .isNotEqualTo(tenantId.toString());
    }
}
