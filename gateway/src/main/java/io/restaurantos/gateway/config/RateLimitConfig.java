package io.restaurantos.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import reactor.core.publisher.Mono;

/**
 * Provides the {@code ipKeyResolver} bean referenced by {@code #{@ipKeyResolver}}
 * SpEL in application.yml RequestRateLimiter filters.
 *
 * <p>Key resolution order:
 * <ol>
 *   <li>First token of {@code X-Forwarded-For} (set by Nginx via {@code proxy_set_header X-Forwarded-For $remote_addr})</li>
 *   <li>Remote address from the TCP connection (fallback when no proxy header)</li>
 * </ol>
 *
 * <p>This ensures per-IP rate limiting works correctly behind Nginx (Pitfall 2 fix).
 * The {@code trusted-proxies} setting in application.yml ensures the gateway accepts
 * the X-Forwarded-For header from the upstream Nginx.
 */
@Configuration
public class RateLimitConfig {

    /**
     * The default key resolver for every route that does not name another one.
     *
     * <p>{@code @Primary} is load-bearing, not decoration. Spring Cloud Gateway's
     * {@code RequestRateLimiterGatewayFilterFactory} takes a single {@link KeyResolver} by type at
     * construction time, so the moment {@link #deviceKeyResolver()} was added as a second bean of
     * that type the factory could no longer be built — and because
     * {@code routeDefinitionRouteLocator} depends on it, the whole gateway context failed to
     * refresh. Not a degraded route: no gateway at all, and every Spring-context test in this
     * module erroring on {@code NoUniqueBeanDefinitionException}. The per-route SpEL
     * ({@code #{@ipKeyResolver}} / {@code #{@deviceKeyResolver}}) chooses the resolver that
     * actually runs; this annotation only says which one the factory may hold as its default.
     */
    @Bean
    @Primary
    public KeyResolver ipKeyResolver() {
        return exchange -> {
            String xff = exchange.getRequest().getHeaders().getFirst("X-Forwarded-For");
            String ip;
            if (xff != null && !xff.isBlank()) {
                ip = xff.split(",")[0].trim();
            } else if (exchange.getRequest().getRemoteAddress() != null) {
                ip = exchange.getRequest().getRemoteAddress().getAddress().getHostAddress();
            } else {
                ip = "unknown";
            }
            return Mono.just(ip);
        };
    }

    /**
     * Per-device rate limiter for the biometric ingest path, keyed on the {@code SN} (serial
     * number) query parameter the ADMS/iClock protocol carries on every call. Referenced by
     * {@code #{@deviceKeyResolver}} on the /iclock and /internal/attendance routes. A single
     * misbehaving device cannot exhaust the shared per-IP budget for a whole branch's traffic.
     */
    @Bean
    public KeyResolver deviceKeyResolver() {
        return exchange -> {
            String sn = exchange.getRequest().getQueryParams().getFirst("SN");
            return Mono.just(sn != null && !sn.isBlank() ? sn : "unknown");
        };
    }
}
