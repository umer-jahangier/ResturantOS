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
     * Per-device rate limiter for the biometric ingest path. Referenced by
     * {@code #{@deviceKeyResolver}} on the /iclock and /internal/attendance routes.
     *
     * <h2>The bug this replaced, which was a cross-tenant availability hole</h2>
     *
     * <p>This resolver used to read the serial from the {@code SN} <b>query parameter</b> only, and
     * fall back to the literal string {@code "unknown"}. The ADMS/iClock protocol does carry {@code SN}
     * on every call, so {@code /iclock} keyed correctly — but {@code /internal/attendance/ingest}
     * carries its serial in a <b>JSON body</b>, so it always missed and always fell back. The
     * consequence was not a slightly coarse limit: because the fallback was a constant, <b>every
     * bridge agent in every tenant on the platform shared one 120-request bucket</b>. One busy branch,
     * or one misconfigured device retrying in a loop, denied service to every other tenant's terminals
     * at once. The route's own comment claimed the opposite.
     *
     * <p>Two changes fix it. The serial is now read from an {@code X-Device-Serial} header as well as
     * the query parameter — the bridge agent is a client we write, so it can send what the limiter
     * needs, whereas consuming the request body in a reactive filter merely to route it is a far
     * larger change than this defect warrants. And the fallback is now the <b>caller's address</b>
     * rather than a constant, so a caller that sends neither is still isolated to its own budget.
     * There is no longer any input for which two different tenants share a key.
     */
    @Bean
    public KeyResolver deviceKeyResolver() {
        return exchange -> {
            String sn = exchange.getRequest().getHeaders().getFirst("X-Device-Serial");
            if (sn == null || sn.isBlank()) {
                sn = exchange.getRequest().getQueryParams().getFirst("SN");
            }
            if (sn != null && !sn.isBlank()) {
                return Mono.just("device:" + sn);
            }
            // Never a constant. A shared fallback key is a shared bucket, and a shared bucket across
            // tenants is a denial-of-service vector reachable by any one of them.
            return ipKeyResolver().resolve(exchange).map(ip -> "device-ip:" + ip);
        };
    }
}
