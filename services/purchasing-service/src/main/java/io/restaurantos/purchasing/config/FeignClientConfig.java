package io.restaurantos.purchasing.config;

import feign.RequestInterceptor;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FeignClientConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Bean
    public RequestInterceptor internalServiceInterceptor(TenantContext tenantContext) {
        return template -> {
            template.header("X-Internal-Service", internalSecret);
            tenantContext.getTenantId().ifPresent(id -> template.header("X-Tenant-Id", id.toString()));
        };
    }
}
