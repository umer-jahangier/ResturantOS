package io.restaurantos.shared.feature;

import io.restaurantos.shared.exception.FeatureDisabledException;
import io.restaurantos.shared.tenant.TenantContext;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;

@Aspect
public class FeatureFlagAspect {
    private final FeatureFlagService featureFlagService;
    private final TenantContext tenantContext;

    public FeatureFlagAspect(FeatureFlagService featureFlagService, TenantContext tenantContext) {
        this.featureFlagService = featureFlagService;
        this.tenantContext = tenantContext;
    }

    @Before("@annotation(requiresFeature) || @within(requiresFeature)")
    public void checkFeature(RequiresFeature requiresFeature) {
        var tenantId = tenantContext.requireTenantId();
        if (!featureFlagService.isEnabled(tenantId, requiresFeature.value())) {
            throw new FeatureDisabledException(requiresFeature.value());
        }
    }
}
