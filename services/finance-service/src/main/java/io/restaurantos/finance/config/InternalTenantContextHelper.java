package io.restaurantos.finance.config;

import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Sets TenantContext for internal service calls (RLS GUC applied at connection checkout). */
@Component
public class InternalTenantContextHelper {

    private final TenantContext tenantContext;

    public InternalTenantContextHelper(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    public void activate(UUID tenantId) {
        tenantContext.set(tenantId, null, null, null);
    }

    /**
     * Branch-scoped variant. Some internal seams (e.g. the AR charge seam, 10-18) call into
     * JournalEntryService.autoPostInternal, whose create() path requires a branch in
     * TenantContext (requireBranchId) — the branchId-less activate(UUID) above leaves that
     * empty, which is the root cause of the pre-existing "Branch context required" failures
     * in InternalAutoPostIT/JournalEntryImmutabilityIT/JournalEntryBalanceTriggerIT. New
     * internal callers that carry a branchId in their request body should use this overload.
     */
    public void activate(UUID tenantId, UUID branchId) {
        tenantContext.set(tenantId, branchId, null, null);
    }

    public void clear() {
        tenantContext.clear();
    }
}
