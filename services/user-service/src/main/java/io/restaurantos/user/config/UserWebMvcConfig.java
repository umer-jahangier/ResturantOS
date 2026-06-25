package io.restaurantos.user.config;

import io.restaurantos.shared.tenant.TenantFilterInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers TenantFilterInterceptor (shared-lib) for all /api/v1/** requests.
 * This sets app.current_tenant_id GUC and enables the Hibernate tenantFilter
 * BEFORE JPA runs — required for branches RLS to isolate tenants correctly.
 */
@Configuration
public class UserWebMvcConfig implements WebMvcConfigurer {

    private final TenantFilterInterceptor tenantFilterInterceptor;

    public UserWebMvcConfig(TenantFilterInterceptor tenantFilterInterceptor) {
        this.tenantFilterInterceptor = tenantFilterInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantFilterInterceptor)
            .addPathPatterns("/api/v1/**");
    }
}
