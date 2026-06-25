package io.restaurantos.gateway.filter;

import io.restaurantos.gateway.client.PlatformAdminClient;
import io.restaurantos.gateway.support.RouteFeatureMap;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * Tenant status + feature-flag + quota enforcement filter.
 *
 * <p>Runs at {@code Ordered.HIGHEST_PRECEDENCE + 20} — AFTER {@link JwtGlobalFilter}
 * (HIGHEST_PRECEDENCE + 10), which has already validated the JWT and injected
 * {@code X-Tenant-Id} into the request headers.
 *
 * <h3>Processing steps (RESEARCH Pattern 3 + FD-15):</h3>
 * <ol>
 *   <li>Skip for public paths and routes with no feature mapping.</li>
 *   <li>Read {@code X-Tenant-Id} from the mutated request (set by JwtGlobalFilter).</li>
 *   <li>Check tenant status via {@code Redis GET tenant:status:{tenantId}};
 *       on miss call platform-admin and cache with 5-min TTL.
 *       If status != ACTIVE → 403 TENANT_SUSPENDED.</li>
 *   <li>Map path → required FEATURE_* code via {@link RouteFeatureMap}.
 *       For mapped routes: {@code Redis GET tenant_features:{tenantId}:{code}};
 *       miss → platform-admin → cache 5-min.
 *       Disabled → 403 FEATURE_DISABLED + X-Upgrade-CTA-URL header.</li>
 *   <li>For quota-bearing routes (NLQ): read {@code nlq_quota:{tenantId}:monthly_count}
 *       against tenant limit. Over → 403 QUOTA_EXCEEDED.
 *       (Counter increments are owned by NLQ service; gateway reads-only here.)</li>
 * </ol>
 *
 * <h3>Redis key shapes:</h3>
 * <pre>
 *   tenant:status:{tenantId}              → "ACTIVE" | "SUSPENDED" | "CANCELLED"
 *   tenant_features:{tenantId}:{code}     → "true" | "false"
 *   nlq_quota:{tenantId}:monthly_count    → integer string (e.g. "4250")
 * </pre>
 */
@Component
public class FeatureFlagGlobalFilter implements GlobalFilter, Ordered {

    private static final Duration CACHE_TTL = Duration.ofMinutes(5);
    private static final long NLQ_DEFAULT_MONTHLY_LIMIT = 5000L;
    private static final String CTA_BASE_URL = "https://app.restaurantos.io/billing?feature=";

    private static final List<String> PUBLIC_PREFIXES = List.of(
            "/api/v1/auth/",
            "/.well-known/",
            "/actuator/",
            "/fallback/"
    );

    private final ReactiveStringRedisTemplate redis;
    private final PlatformAdminClient platformAdminClient;
    private final RouteFeatureMap routeFeatureMap;

    public FeatureFlagGlobalFilter(ReactiveStringRedisTemplate redis,
                                   PlatformAdminClient platformAdminClient,
                                   RouteFeatureMap routeFeatureMap) {
        this.redis = redis;
        this.platformAdminClient = platformAdminClient;
        this.routeFeatureMap = routeFeatureMap;
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 20;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        if (isPublicPath(path)) {
            return chain.filter(exchange);
        }

        String tenantIdHeader = exchange.getRequest().getHeaders().getFirst("X-Tenant-Id");
        if (tenantIdHeader == null) {
            // JwtGlobalFilter would have blocked this — safety check only
            return chain.filter(exchange);
        }

        UUID tenantId;
        try {
            tenantId = UUID.fromString(tenantIdHeader);
        } catch (IllegalArgumentException e) {
            return chain.filter(exchange);
        }

        // Step 1: check tenant status
        return getTenantStatus(tenantId)
                .flatMap(status -> {
                    if (!"ACTIVE".equalsIgnoreCase(status)) {
                        return writeError(exchange, HttpStatus.FORBIDDEN,
                                "{\"error\":{\"code\":\"TENANT_SUSPENDED\"," +
                                "\"message\":\"Your account has been suspended. Contact support.\"}}",
                                null, null);
                    }

                    // Step 2: check feature flag for this route
                    return routeFeatureMap.featureFor(path)
                            .map(featureCode -> checkFeatureFlag(exchange, chain, tenantId, featureCode, path))
                            .orElse(checkQuota(exchange, chain, tenantId, path));
                });
    }

    private Mono<Void> checkFeatureFlag(ServerWebExchange exchange, GatewayFilterChain chain,
                                        UUID tenantId, String featureCode, String path) {
        return isFeatureEnabled(tenantId, featureCode)
                .flatMap(enabled -> {
                    if (!enabled) {
                        return writeError(exchange, HttpStatus.FORBIDDEN,
                                "{\"error\":{\"code\":\"FEATURE_DISABLED\"," +
                                "\"message\":\"Upgrade to enable this feature\"}}",
                                "X-Upgrade-CTA-URL", CTA_BASE_URL + featureCode);
                    }
                    return checkQuota(exchange, chain, tenantId, path);
                });
    }

    private Mono<Void> checkQuota(ServerWebExchange exchange, GatewayFilterChain chain,
                                   UUID tenantId, String path) {
        if (!routeFeatureMap.isQuotaBearing(path)) {
            return chain.filter(exchange);
        }

        String quotaKey = "nlq_quota:" + tenantId + ":monthly_count";
        return redis.opsForValue().get(quotaKey)
                .defaultIfEmpty("0")
                .flatMap(countStr -> {
                    long count;
                    try {
                        count = Long.parseLong(countStr);
                    } catch (NumberFormatException e) {
                        count = 0;
                    }
                    if (count >= NLQ_DEFAULT_MONTHLY_LIMIT) {
                        return writeError(exchange, HttpStatus.FORBIDDEN,
                                "{\"error\":{\"code\":\"QUOTA_EXCEEDED\"," +
                                "\"message\":\"Monthly NLQ quota exceeded. Upgrade for more.\"}}",
                                "X-Upgrade-CTA-URL", CTA_BASE_URL + "FEATURE_NLQ");
                    }
                    return chain.filter(exchange);
                });
    }

    /**
     * Returns the tenant status, using Redis as cache (5-min TTL) and
     * platform-admin as cache-miss fallback.
     */
    private Mono<String> getTenantStatus(UUID tenantId) {
        String key = "tenant:status:" + tenantId;
        return redis.opsForValue().get(key)
                .switchIfEmpty(
                        platformAdminClient.getStatus(tenantId)
                                .doOnNext(status ->
                                        redis.opsForValue()
                                                .set(key, status, CACHE_TTL)
                                                .subscribe()
                                )
                )
                .defaultIfEmpty("ACTIVE"); // safe default when both Redis and platform-admin unavailable
    }

    /**
     * Returns whether a feature is enabled for the tenant.
     * Uses Redis with platform-admin fallback (5-min TTL).
     * Redis key: {@code tenant_features:{tenantId}:{featureCode}}
     */
    private Mono<Boolean> isFeatureEnabled(UUID tenantId, String featureCode) {
        String key = "tenant_features:" + tenantId + ":" + featureCode;
        return redis.opsForValue().get(key)
                .switchIfEmpty(
                        platformAdminClient.getFeaturesCsv(tenantId)
                                .flatMap(csv -> {
                                    List<String> enabled = csv.isBlank()
                                            ? List.of() : Arrays.asList(csv.split(","));
                                    String value = String.valueOf(enabled.contains(featureCode));
                                    return redis.opsForValue()
                                            .set(key, value, CACHE_TTL)
                                            .thenReturn(value);
                                })
                )
                .map(val -> "true".equalsIgnoreCase(val))
                .defaultIfEmpty(false);
    }

    private boolean isPublicPath(String path) {
        return PUBLIC_PREFIXES.stream().anyMatch(path::startsWith);
    }

    /**
     * Writes a JSON error response with optional extra header, then completes the chain.
     * The upstream is NEVER called.
     */
    private Mono<Void> writeError(ServerWebExchange exchange, HttpStatus status,
                                   String body, String extraHeaderName, String extraHeaderValue) {
        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        if (extraHeaderName != null) {
            exchange.getResponse().getHeaders().add(extraHeaderName, extraHeaderValue);
        }
        byte[] bytes = body.getBytes();
        return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(bytes))
        );
    }
}
