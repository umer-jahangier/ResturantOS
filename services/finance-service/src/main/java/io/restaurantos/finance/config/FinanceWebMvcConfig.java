package io.restaurantos.finance.config;

import io.restaurantos.shared.tenant.TenantFilterInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers TenantFilterInterceptor for finance API routes.
 * Kept separate from security config so servlet security init does not pull in
 * EntityManager-dependent beans before JPA has finished bootstrapping (Boot 4).
 */
@Configuration
public class FinanceWebMvcConfig implements WebMvcConfigurer {

    private final TenantFilterInterceptor tenantFilterInterceptor;

    public FinanceWebMvcConfig(TenantFilterInterceptor tenantFilterInterceptor) {
        this.tenantFilterInterceptor = tenantFilterInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantFilterInterceptor)
            .addPathPatterns("/api/v1/**");
    }
}
