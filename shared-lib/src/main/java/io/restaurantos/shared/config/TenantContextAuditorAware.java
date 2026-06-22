package io.restaurantos.shared.config;

import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.AuditorAware;

import java.util.Optional;
import java.util.UUID;

/**
 * Provides the current user UUID for @CreatedBy / @LastModifiedBy on TenantAuditableEntity.
 * Backed by TenantContext which is populated from the JWT sub claim.
 */
public class TenantContextAuditorAware implements AuditorAware<UUID> {
    private final TenantContext tenantContext;

    public TenantContextAuditorAware(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    @Override
    public Optional<UUID> getCurrentAuditor() {
        return tenantContext.getUserId();
    }
}
