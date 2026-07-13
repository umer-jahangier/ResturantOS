package io.restaurantos.shared.tenant;

import jakarta.persistence.EntityManager;

import java.util.UUID;

/**
 * Sets {@code app.current_tenant_id} (and {@code app.current_branch_id} when present) on the
 * current JPA connection inside a transaction. Mirrors {@link TenantAwareDataSource}; both GUCs
 * are transaction-local.
 */
public final class TenantGucHelper {

    private TenantGucHelper() {}

    public static void apply(EntityManager entityManager, TenantContext tenantContext) {
        if (tenantContext.getTenantId().isEmpty()) {
            return;
        }
        UUID tenantId = tenantContext.requireTenantId();
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
        tenantContext.getBranchId().ifPresent(branchId ->
            entityManager.createNativeQuery("SELECT set_config('app.current_branch_id', :bid, true)")
                .setParameter("bid", branchId.toString())
                .getSingleResult());
    }
}
