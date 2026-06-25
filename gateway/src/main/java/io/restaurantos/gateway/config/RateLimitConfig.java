package io.restaurantos.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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

    @Bean
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
}
