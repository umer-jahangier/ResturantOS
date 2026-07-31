package io.restaurantos.inventory.config;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Outbound service-to-service call configuration, mirroring finance-service's
 * {@code FeignClientConfig} exactly — the same shared-secret header every {@code /internal/**}
 * filter in this repo checks, plus caller-JWT forwarding.
 *
 * <p>NOTE: this is the third near-identical copy of this class (finance-service, file-service's
 * {@code FeignSharedConfig}, and now here). It is duplicated rather than lifted into shared-lib
 * because doing that would put the Feign dependency on every service that consumes shared-lib,
 * including the ones that make no outbound calls. Worth consolidating the next time a fourth
 * service needs it.
 */
@Configuration
public class FeignClientConfig {

    @Value("${restaurantos.internal.secret:dev-internal-secret}")
    private String internalSecret;

    @Bean
    public RequestInterceptor inventoryInternalServiceInterceptor() {
        return template -> {
            template.header("X-Internal-Service", internalSecret);
            forwardCallerJwt(template);
        };
    }

    /**
     * Forwards the end user's bearer token to internal callees. Inventory's own calls are
     * tenant-scoped via an explicit {@code X-Tenant-Id} header rather than the token, but the
     * token is forwarded anyway so a callee that dual-gates (service secret proves the CALLER,
     * JWT proves the SUBJECT — see finance's note on authorization-service) keeps working.
     */
    private static void forwardCallerJwt(RequestTemplate template) {
        if (template.headers().containsKey(HttpHeaders.AUTHORIZATION)) {
            return;
        }
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs)) {
            // No inbound request (scheduled sweep, event consumer). Nothing to forward.
            return;
        }
        HttpServletRequest request = attrs.getRequest();
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization != null && !authorization.isBlank()) {
            template.header(HttpHeaders.AUTHORIZATION, authorization);
        }
    }
}
