package io.restaurantos.kitchen;

import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Does {@code TenantAwareDataSource} actually put the tenant GUC on the connection a
 * {@code @Transactional} service call uses, when the context was set by a test thread rather than
 * by an HTTP filter?
 *
 * <p>Written because kitchen's service-level ITs began failing "new row violates row-level security
 * policy" the moment the harness stopped connecting as a superuser — while
 * {@code tenantContext.requireTenantId()} inside the very same call returned a tenant. Context
 * present but policy refusing means the GUC and the context disagree, and that is worth knowing
 * precisely: a fixture that forgot to set something is a test problem, a GUC that never arrives is
 * a production one.
 */
class TenantGucProbeIT extends KitchenTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired TransactionTemplate txTemplate;
    @PersistenceContext EntityManager entityManager;

    @Test
    void theGucOnTheConnectionMatchesTheContextTheServiceSees() {
        UUID tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, UUID.randomUUID(), null, null);

        String guc = txTemplate.execute(tx -> (String) entityManager
                .createNativeQuery("SELECT current_setting('app.current_tenant_id', true)")
                .getSingleResult());

        System.out.println("[guc probe] context=" + tenantId + " connection GUC=" + guc);

        assertThat(guc)
                .as("""
                    TenantContext holds %s but the connection this transaction ran on carries GUC \
                    '%s'. Every RLS policy in this service reads that GUC, so reads return nothing \
                    and writes are refused — TenantAwareDataSource is not reaching this path.""",
                        tenantId, guc)
                .isEqualTo(tenantId.toString());
    }
}
