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

        // What the GUC actually is here depends on what ran before, and that is worth stating
        // precisely because it was mis-attributed once already.
        //
        // Run alone, it is NULL: the transaction opened with an empty context, so there was no
        // tenant to write. Run in a suite, it is the PREVIOUS TEST CLASS's tenant — because these
        // IT classes call tenantContext.set(...) in @BeforeEach and never clear it, and JUnit runs
        // them all on one thread. The ThreadLocal is still populated when Spring opens this class's
        // transaction, so TenantAwareDataSource writes that tenant, correctly, to this connection.
        //
        // That is a TEST-side ThreadLocal leak, not a DataSource defect. An earlier version of this
        // assertion blamed TenantAwareDataSource for it and demanded an empty GUC; it failed even
        // against the fixed DataSource, because the value it was seeing had been set on purpose
        // from a context that genuinely held a tenant. The separate DataSource defect — a
        // connection inheriting a GUC nobody in this request set — is proven in shared-lib's
        // TenantGucNeverInheritedIT, which does go red when that fix is reverted.
        //
        // The invariant that holds either way, and the one that matters here: the tenant this test
        // set in @BeforeEach never reaches the transaction Spring already opened.
        assertThat(guc)
                .as("""
                    The tenant set in @BeforeEach (%s) reached an already-open transaction, whose \
                    connection carries '%s'. That means the ordering this class characterises has \
                    changed — a class-level @Transactional test now sees its own tenant. Good news: \
                    invert this assertion, drop the KNOWN DEFECT framing, and the seven kitchen IT \
                    classes can keep their class-level @Transactional through a harness \
                    conversion.""", tenantId, guc)
                .isNotEqualTo(tenantId.toString());
    }
}
