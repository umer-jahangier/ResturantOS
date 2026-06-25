package io.restaurantos.gateway.filter;

import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.gateway.client.PlatformAdminClient;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.UUID;

/**
 * Resolves the {@code tenant_id} for an authenticated request.
 *
 * <h3>Resolution strategy (Open Q2 — Phase 3 scope):</h3>
 * <ol>
 *   <li><b>PRIMARY</b> — JWT {@code tenant_id} claim (populated by auth-service at login).</li>
 *   <li><b>SECONDARY</b> — {@code Host} header slug lookup:
 *     <ol>
 *       <li>Extract subdomain slug from {@code Host} header (e.g. {@code acme.restaurantos.io} → {@code acme}).</li>
 *       <li>{@code Redis GET tenant:slug:{slug}} → tenantId.</li>
 *       <li>On Redis miss: call {@link PlatformAdminClient#getTenantIdBySlug(String)}.</li>
 *     </ol>
 *     Full custom-domain provisioning is a later milestone (see RESEARCH Open Q2).
 *     This path is minimal-but-present for platform multi-tenancy.
 *   </li>
 * </ol>
 *
 * <p>If the tenant_id cannot be resolved on a protected path, throws
 * {@link IllegalStateException} → caller writes 401 UNAUTHENTICATED.
 */
@Component
public class TenantResolutionSupport {

    private static final String SLUG_REDIS_KEY_PREFIX = "tenant:slug:";

    private final ReactiveStringRedisTemplate redis;
    private final PlatformAdminClient platformAdminClient;

    public TenantResolutionSupport(ReactiveStringRedisTemplate redis,
                                   PlatformAdminClient platformAdminClient) {
        this.redis = redis;
        this.platformAdminClient = platformAdminClient;
    }

    /**
     * Resolves tenant_id from the JWT claims (primary) or Host header (secondary).
     *
     * @return {@link Mono} emitting the resolved {@link UUID} tenant ID
     */
    public Mono<UUID> resolve(ServerWebExchange exchange, JwtClaims claims) {
        // PRIMARY: JWT tenant_id claim is the fast path (99% of requests)
        if (claims.tenantId() != null) {
            return Mono.just(claims.tenantId());
        }

        // SECONDARY: slug-based resolution from Host header
        String host = exchange.getRequest().getHeaders().getFirst(HttpHeaders.HOST);
        if (host == null || host.isBlank()) {
            return Mono.error(new IllegalStateException("Cannot resolve tenant: no tenant_id claim and no Host header"));
        }

        String slug = extractSlug(host);
        if (slug == null) {
            return Mono.error(new IllegalStateException("Cannot resolve tenant slug from Host: " + host));
        }

        String redisKey = SLUG_REDIS_KEY_PREFIX + slug;
        return redis.opsForValue().get(redisKey)
                .map(UUID::fromString)
                .switchIfEmpty(
                        // Redis miss: call platform-admin internal endpoint
                        platformAdminClient.getTenantIdBySlug(slug)
                                .doOnNext(tenantId ->
                                        // Warm the cache for next request (5-min TTL)
                                        redis.opsForValue()
                                                .set(redisKey, tenantId.toString(),
                                                        java.time.Duration.ofMinutes(5))
                                                .subscribe()
                                )
                )
                .onErrorMap(ex -> !(ex instanceof IllegalStateException),
                        ex -> new IllegalStateException("Tenant resolution failed for slug: " + slug, ex));
    }

    /**
     * Extracts the subdomain slug from the Host header.
     * Example: {@code acme.restaurantos.io:443} → {@code acme}.
     * Returns {@code null} if the host has no subdomain (bare domain or IP).
     */
    private String extractSlug(String host) {
        // Strip port
        String stripped = host.contains(":") ? host.substring(0, host.lastIndexOf(':')) : host;
        String[] parts = stripped.split("\\.", 2);
        if (parts.length < 2) {
            return null;
        }
        String candidate = parts[0];
        // Reject reserved names and IPs
        return (candidate.isEmpty() || candidate.equals("www") || candidate.equals("api"))
                ? null : candidate;
    }
}
