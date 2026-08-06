package io.restaurantos.gateway.filter;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Strips every header the gateway itself is the sole authority for, from every inbound request.
 *
 * <p>{@code X-Internal-Service} identifies microservices to each other on service-to-service
 * calls. {@code X-TOTP-Verified} tells hr-service and finance-service that the caller's login
 * verified a TOTP code, and is the gate on payroll approval and accounting-period close — the two
 * money-moving endpoints. Both are trusted absolutely by the services that read them, so neither
 * may survive from an external client: they are removed unconditionally here and, in the case of
 * {@code X-TOTP-Verified}, re-created by {@link JwtGlobalFilter} from the signed
 * {@code totp_verified} JWT claim.
 *
 * <p>{@code X-Acting-User-Id} names the human on whose behalf a privilege-bearing
 * {@code /internal/auth/**} write is made, and auth-service bounds what that write may grant by
 * recomputing that user's own permissions (13-11's role ceiling). It is asserted by the calling
 * SERVICE from a verified JWT. A client that could set it would be choosing which authority to be
 * measured against, so it is removed here on the same unconditional basis as the other two — even
 * though no gateway route maps to {@code /internal/**} today, which makes this the belt to that
 * route table's braces. A future route added without reading this file must not silently reopen it.
 *
 * <p>This is intentionally a {@link GlobalFilter} (not a default-filter in application.yml)
 * so it applies to ALL routes, including those registered programmatically.
 * Runs at {@code HIGHEST_PRECEDENCE + 5}, before JWT validation, because the headers
 * must be stripped even for requests that fail authentication — a request that never reaches
 * {@link JwtGlobalFilter}'s injection step (public path, 401, WS upgrade without a token) must
 * still reach its upstream with the client's forged value gone rather than merely unreplaced.
 */
@Component
public class StripInternalHeaderFilter implements GlobalFilter, Ordered {

    private static final String INTERNAL_HEADER = "X-Internal-Service";
    static final String TOTP_VERIFIED_HEADER = "X-TOTP-Verified";
    static final String ACTING_USER_HEADER = "X-Acting-User-Id";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(headers -> {
                    headers.remove(INTERNAL_HEADER);
                    headers.remove(TOTP_VERIFIED_HEADER);
                    headers.remove(ACTING_USER_HEADER);
                })
                .build();
        return chain.filter(exchange.mutate().request(request).build());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 5;
    }
}
