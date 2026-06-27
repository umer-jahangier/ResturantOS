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

    public void clear() {
        tenantContext.clear();
    }
}
