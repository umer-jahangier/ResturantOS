package io.restaurantos.finance.config;

import feign.RequestInterceptor;
import feign.RequestTemplate;
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
    public RequestInterceptor internalServiceInterceptor() {
        return template -> {
            template.header("X-Internal-Service", internalSecret);
            forwardCallerJwt(template);
        };
    }

    /**
     * Forwards the end user's bearer token to internal callees.
     *
     * <p>authorization-service's {@code POST /internal/authorize} is dual-gated: the
     * X-Internal-Service secret proves the CALLER is a trusted service, and the JWT proves the
     * SUBJECT is a real user — the endpoint reads {@code JwtClaims} off its SecurityContext to
     * decide on that user's permissions, tenant and branch. Sending only the service secret left the
     * call unauthenticated, so expense approve/reject (OPA-gated through this client) failed for
     * every user.
     *
     * <p>Invisible to the integration tests, which stub the authorize call — they exercise the OPA
     * policy but never the service-to-service call path.
     */
    private static void forwardCallerJwt(RequestTemplate template) {
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
