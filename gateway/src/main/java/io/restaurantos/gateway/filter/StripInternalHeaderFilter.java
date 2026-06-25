package io.restaurantos.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Strips the {@code X-Internal-Service} header from every inbound request.
 *
 * <p>Internal microservices use {@code X-Internal-Service} to identify each other when
 * making service-to-service calls. External clients must never be allowed to forge this
 * header, so the gateway removes it unconditionally from all public traffic.
 *
 * <p>This is intentionally a {@link GlobalFilter} (not a default-filter in application.yml)
 * so it applies to ALL routes, including those registered programmatically.
 * Runs at {@code HIGHEST_PRECEDENCE + 5}, before JWT validation, because the header
 * must be stripped even for requests that fail authentication.
 */
@Component
public class StripInternalHeaderFilter implements GlobalFilter, Ordered {

    private static final String INTERNAL_HEADER = "X-Internal-Service";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(headers -> headers.remove(INTERNAL_HEADER))
                .build();
        return chain.filter(exchange.mutate().request(request).build());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 5;
    }
}
