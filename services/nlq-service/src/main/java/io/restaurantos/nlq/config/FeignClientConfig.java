package io.restaurantos.nlq.config;

import feign.RequestInterceptor;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Configuration
public class FeignClientConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Bean
    public RequestInterceptor internalServiceInterceptor(TenantContext tenantContext) {
        return template -> {
            template.header("X-Internal-Service", internalSecret);
            tenantContext.getTenantId().ifPresent(id -> template.header("X-Tenant-Id", id.toString()));
            forwardCallerJwt(template);
        };
    }

    /**
     * Forwards the end user's bearer token to internal callees.
     *
     * <p>authorization-service's {@code POST /internal/authorize} is dual-gated: the
     * X-Internal-Service secret proves the CALLER is a trusted service, and the JWT proves the
     * SUBJECT is a real user — the endpoint reads {@code JwtClaims} off its SecurityContext to
     * decide on that user's permissions, tenant and branch. Sending only the service secret left it
     * unauthenticated, so every authorize call was rejected and purchasing-service surfaced the
     * failure as a 503: no purchase order could be approved or short-closed by anyone.
     *
     * <p>This was invisible to the integration tests, which stub the authorize call and therefore
     * exercise the OPA policy but never the service-to-service call path.
     */
    private static void forwardCallerJwt(feign.RequestTemplate template) {
        if (template.headers().containsKey(HttpHeaders.AUTHORIZATION)) {
            return;
        }
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs)) {
            // No inbound request (async worker, event consumer, scheduled job). Nothing to forward.
            return;
        }
        HttpServletRequest request = attrs.getRequest();
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization != null && !authorization.isBlank()) {
            template.header(HttpHeaders.AUTHORIZATION, authorization);
        }
    }
}
