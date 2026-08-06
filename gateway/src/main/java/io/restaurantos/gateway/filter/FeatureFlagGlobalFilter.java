package io.restaurantos.gateway.filter;

import io.restaurantos.gateway.client.PlatformAdminClient;
import io.restaurantos.gateway.support.RouteFeatureMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
 *       If status != ACTIVE → 403 TENANT_SUSPENDED.
 *       If the status cannot be determined at all → 503 TENANT_STATUS_UNAVAILABLE and nothing is
 *       cached, unless {@code restaurantos.fail-open-on-platform-down} is explicitly enabled.</li>
 *   <li>Map path → required FEATURE_* code via {@link RouteFeatureMap}.
 *       For mapped routes: {@code Redis GET tenant_features:{tenantId}:{code}};
 *       miss → platform-admin → cache 5-min.
 *       Disabled → 403 FEATURE_DISABLED + X-Upgrade-CTA-URL header.</li>
 *   <li>For quota-bearing routes (NLQ): read {@code nlq_quota:{tenantId}:monthly_count}
 *       against THE TENANT'S OWN limit, resolved from platform-admin and cached at
 *       {@code tenant:nlq_quota:{tenantId}}. Over → 429 QUOTA_EXCEEDED. An allowance or a counter
 *       that cannot be determined → 503 NLQ_QUOTA_UNAVAILABLE, never a silent grant.
 *       (Counter increments are owned by NLQ service; gateway reads-only here.)</li>
 * </ol>
 *
 * <h3>Redis key shapes:</h3>
 * <pre>
 *   tenant:status:{tenantId}              → "ACTIVE" | "SUSPENDED" | "CANCELLED"
 *   tenant_features:{tenantId}:{code}     → "true" | "false"
 *   tenant:nlq_quota:{tenantId}           → integer string, the tenant's monthly allowance
 *   nlq_quota:{tenantId}:monthly_count    → integer string, usage so far (e.g. "4250")
 * </pre>
 */
@Component
public class FeatureFlagGlobalFilter implements GlobalFilter, Ordered {

    private static final Duration CACHE_TTL = Duration.ofMinutes(5);
    private static final String CTA_BASE_URL = "https://app.restaurantos.io/billing?feature=";

    /**
     * The per-tenant NLQ allowance, cached from platform-admin's status response and written
     * directly by {@code TenantSubscriptionService.changeTier} so a tier change takes effect at
     * once.
     *
     * <p><b>This key shape is a contract with two other components</b> —
     * {@code TenantSubscriptionService.QUOTA_KEY_PREFIX} writes it and nlq-service's
     * {@code NlqQuotaService} reads it. Changing it in one place silently returns the others to a
     * compiled-in constant, which is the exact defect 13-14 removed.
     */
    private static final String QUOTA_KEY = "tenant:nlq_quota:";

    /**
     * "We could not determine this tenant's allowance." Not a limit, and never compared against a
     * counter — see {@code quotaUndeterminable}. It replaced a compiled-in 5,000 that was applied
     * to every tenant regardless of what they had bought.
     */
    private static final long UNDETERMINED_QUOTA = -1L;

    private static final List<String> PUBLIC_PREFIXES = List.of(
            "/api/v1/auth/",
            "/.well-known/",
            "/actuator/",
            "/fallback/"
    );

    private static final Logger log = LoggerFactory.getLogger(FeatureFlagGlobalFilter.class);

    private final ReactiveStringRedisTemplate redis;
    private final PlatformAdminClient platformAdminClient;
    private final RouteFeatureMap routeFeatureMap;

    /**
     * When a determination cannot be reached: true → allow through, false → deny. Never cached
     * either way.
     *
     * <p>ONE lever, governing both the feature-flag path and the tenant-status path. Deliberately not
     * a second property for status: two levers that can disagree give an operator a configuration in
     * which entitlement fails closed and suspension fails open, which is the worst of both and is
     * invisible until someone tests it. Defaults to closed.
     */
    @Value("${restaurantos.fail-open-on-platform-down:false}")
    private boolean failOpen;

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
                .flatMap(resolution -> {
                    if (resolution.isUnknown()) {
                        // Nobody could tell us. Suspension is the platform's primary non-payment
                        // lever, so an undetermined status must NOT be read as good standing —
                        // otherwise any platform-admin or Redis outage restores full access to every
                        // tenant that has been cut off. The one lever that overrides this is the same
                        // one the feature-flag path honours; see the field comment on failOpen.
                        if (failOpen) {
                            log.warn("[tenant-status] proceeding for tenant={} on an UNDETERMINED status "
                                    + "because restaurantos.fail-open-on-platform-down is enabled", tenantId);
                            return chain.filter(exchange);
                        }
                        // 503, not 403, and a distinct code: an operator reading this must be able to
                        // tell "we refused you" from "we could not tell", and a client must be able to
                        // tell a retryable outage from a settled account decision.
                        return writeError(exchange, HttpStatus.SERVICE_UNAVAILABLE,
                                "{\"error\":{\"code\":\"TENANT_STATUS_UNAVAILABLE\"," +
                                "\"message\":\"Unable to verify account status. Please retry shortly.\"}}",
                                null, null);
                    }

                    if (!resolution.isActive()) {
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

    /**
     * Enforces the tenant's OWN monthly NLQ allowance against the counter nlq-service maintains.
     *
     * <p><b>What changed in 13-14.</b> This compared the counter against a compiled-in
     * {@code NLQ_DEFAULT_MONTHLY_LIMIT = 5000} while every tenant row carried an
     * {@code nlq_quota} column that nothing ever read — so an ENTERPRISE tenant paying for 50,000
     * queries was cut off at 5,000, and a STARTER tenant entitled to 1,000 was given five times what
     * it bought. The limit now comes from {@link #resolveQuotaLimit}.
     *
     * <p><b>Both unknowns fail closed, and they are different unknowns.</b>
     * <ul>
     *   <li>The LIMIT cannot be determined (platform-admin down, no number for this tenant) → 503
     *       {@code NLQ_QUOTA_UNAVAILABLE}. Serving the request would be granting an unmetered
     *       Claude-backed endpoint, which is a billing incident rather than a degraded feature —
     *       the same judgement {@code NlqQuotaService} already makes on its own Redis outage.</li>
     *   <li>The COUNTER cannot be read, or reads as something that is not a number → 503 as well.
     *       Note that an ABSENT counter is NOT an unknown: it legitimately means zero usage at the
     *       start of a month, and {@code defaultIfEmpty("0")} is the correct reading of it. A failed
     *       READ is what previously escaped the filter entirely and surfaced as 401 UNAUTHENTICATED
     *       via {@code JwtGlobalFilter}'s blanket handler (13-03 "left open" #3).</li>
     * </ul>
     * Both honour the single {@code failOpen} lever, for the reason on the field: two levers that
     * can disagree give an operator a configuration nobody has tested.
     */
    private Mono<Void> checkQuota(ServerWebExchange exchange, GatewayFilterChain chain,
                                   UUID tenantId, String path) {
        if (!routeFeatureMap.isQuotaBearing(path)) {
            return chain.filter(exchange);
        }

        return resolveQuotaLimit(tenantId).flatMap(limit -> {
            if (limit < 0) {
                return quotaUndeterminable(exchange, chain, tenantId, "limit");
            }
            String quotaKey = "nlq_quota:" + tenantId + ":monthly_count";
            return redis.opsForValue().get(quotaKey)
                    // An absent counter is a real answer: nothing has been spent this month.
                    .defaultIfEmpty("0")
                    .flatMap(countStr -> {
                        long count;
                        try {
                            count = Long.parseLong(countStr.trim());
                        } catch (NumberFormatException e) {
                            // A counter that is not a number is a corrupt counter, not a zero one.
                            // Reading it as zero granted a full month's quota to anything that could
                            // write a junk value into that key.
                            log.warn("[nlq-quota] counter for tenant={} is not a number ({}) — "
                                    + "refusing rather than reading it as zero", tenantId, countStr);
                            return quotaUndeterminable(exchange, chain, tenantId, "counter");
                        }
                        if (count >= limit) {
                            return writeError(exchange, HttpStatus.TOO_MANY_REQUESTS,
                                    "{\"error\":{\"code\":\"QUOTA_EXCEEDED\"," +
                                    "\"message\":\"Monthly NLQ quota exceeded. Upgrade for more.\"}}",
                                    "X-Upgrade-CTA-URL", CTA_BASE_URL + "FEATURE_NLQ");
                        }
                        return chain.filter(exchange);
                    })
                    .onErrorResume(ex -> {
                        log.warn("[nlq-quota] counter read failed for tenant={} — quota "
                                + "undetermined; failOpen={}", tenantId, failOpen, ex);
                        return quotaUndeterminable(exchange, chain, tenantId, "counter");
                    });
        });
    }

    private Mono<Void> quotaUndeterminable(ServerWebExchange exchange, GatewayFilterChain chain,
                                            UUID tenantId, String what) {
        if (failOpen) {
            log.warn("[nlq-quota] proceeding for tenant={} on an UNDETERMINED {} because "
                    + "restaurantos.fail-open-on-platform-down is enabled", tenantId, what);
            return chain.filter(exchange);
        }
        return writeError(exchange, HttpStatus.SERVICE_UNAVAILABLE,
                "{\"error\":{\"code\":\"NLQ_QUOTA_UNAVAILABLE\"," +
                "\"message\":\"Unable to verify your query allowance. Please retry shortly.\"}}",
                null, null);
    }

    /**
     * The tenant's monthly NLQ allowance, or a negative number meaning "could not be determined".
     *
     * <p>Cached under {@link #QUOTA_KEY} with the same 5-minute TTL as the status, and — like the
     * status — an unknown is NEVER written to the cache. {@code TenantSubscriptionService.changeTier}
     * writes this key directly on a tier change, so a tenant that upgrades is enforced at its new
     * allowance on the very next request rather than up to five minutes later.
     *
     * <p>A negative sentinel rather than an {@code Optional}/empty Mono because {@code Mono.empty()}
     * inside a {@code flatMap} silently drops the request — a filter that completes without either
     * calling the chain or writing a response hangs the caller. A value that must be inspected
     * cannot be forgotten.
     */
    private Mono<Long> resolveQuotaLimit(UUID tenantId) {
        String key = QUOTA_KEY + tenantId;
        return redis.opsForValue().get(key)
                .map(raw -> {
                    try {
                        return Long.parseLong(raw.trim());
                    } catch (NumberFormatException e) {
                        return UNDETERMINED_QUOTA;
                    }
                })
                .switchIfEmpty(Mono.defer(() -> platformAdminClient.getTenantStatus(tenantId)
                        .flatMap(status -> {
                            if (status.nlqQuota() == null) {
                                log.warn("[nlq-quota] platform-admin returned no quota for tenant={} "
                                        + "— not caching; failOpen={}", tenantId, failOpen);
                                return Mono.just(UNDETERMINED_QUOTA);
                            }
                            long limit = status.nlqQuota();
                            return redis.opsForValue().set(key, String.valueOf(limit), CACHE_TTL)
                                    .thenReturn(limit);
                        })
                        .switchIfEmpty(Mono.just(UNDETERMINED_QUOTA))
                        .onErrorResume(ex -> {
                            log.warn("[nlq-quota] limit lookup failed for tenant={} — not caching; "
                                    + "failOpen={}", tenantId, failOpen, ex);
                            return Mono.just(UNDETERMINED_QUOTA);
                        })))
                .onErrorResume(ex -> {
                    log.warn("[nlq-quota] limit cache read failed for tenant={} — undetermined; "
                            + "failOpen={}", tenantId, failOpen, ex);
                    return Mono.just(UNDETERMINED_QUOTA);
                });
    }

    /**
     * The outcome of a tenant-status lookup — three outcomes, not two.
     *
     * <p>{@link #UNKNOWN} exists because the previous code had nowhere to put it. Its resolution
     * chain ended in {@code .defaultIfEmpty("ACTIVE")}, which is not a default so much as an
     * assertion: it told the filter that a tenant nobody had been able to ask about was in good
     * standing. "We could not determine this" is a distinct answer from both "active" and
     * "suspended", and collapsing it into either one is how an infrastructure outage becomes an
     * authorization decision.
     */
    private record StatusResolution(String status) {

        /** No determination was reached — not a status, and never cached. */
        static final StatusResolution UNKNOWN = new StatusResolution(null);

        static StatusResolution determined(String status) {
            return new StatusResolution(status);
        }

        boolean isUnknown() {
            return status == null;
        }

        boolean isActive() {
            return "ACTIVE".equalsIgnoreCase(status);
        }
    }

    /**
     * Resolves the tenant status from Redis (5-min TTL) with platform-admin as the cache-miss
     * fallback, or reports that it could not be resolved.
     *
     * <p>Deliberately the same shape as {@link #isFeatureEnabled}: look in the cache, fall back to
     * platform-admin, cache only a real answer, and treat a failure as unknown rather than as a
     * value. The two paths guard the same trust boundary and any difference between them is a
     * difference an attacker or an outage gets to choose between.
     *
     * <p>Every non-answer lands on {@link StatusResolution#UNKNOWN}: platform-admin erroring, Redis
     * being unreachable for either the read or the cache write, and platform-admin answering with no
     * body at all — that last one being the case {@code .defaultIfEmpty("ACTIVE")} literally sat on.
     * An empty response is exactly as uninformative as no response.
     */
    private Mono<StatusResolution> getTenantStatus(UUID tenantId) {
        String key = "tenant:status:" + tenantId;
        return redis.opsForValue().get(key)
                .map(StatusResolution::determined)
                .switchIfEmpty(Mono.defer(() -> resolveAndCacheStatus(tenantId, key)))
                .onErrorResume(ex -> {
                    // Reaching here means the Redis READ itself failed; the fallback below already
                    // handles its own errors. Previously this propagated out of the filter, was
                    // caught by JwtGlobalFilter's onErrorResume, and surfaced as 401 UNAUTHENTICATED
                    // — telling the operator the caller's credentials were bad during a Redis outage.
                    log.warn("[tenant-status] cache read failed for tenant={} — status undetermined; "
                            + "failOpen={}", tenantId, failOpen, ex);
                    return Mono.just(StatusResolution.UNKNOWN);
                });
    }

    private Mono<StatusResolution> resolveAndCacheStatus(UUID tenantId, String key) {
        return platformAdminClient.getStatus(tenantId)
                .flatMap(status -> redis.opsForValue()
                        .set(key, status, CACHE_TTL)
                        .thenReturn(StatusResolution.determined(status)))
                .switchIfEmpty(Mono.defer(() -> {
                    log.warn("[tenant-status] platform-admin returned no status for tenant={} — "
                            + "not caching; failOpen={}", tenantId, failOpen);
                    return Mono.just(StatusResolution.UNKNOWN);
                }))
                // An unknown answer is never written to the cache. Caching a guess would turn a
                // momentary blip into a hard refusal for the full 5-minute TTL — and, if the guess
                // were "ACTIVE", would keep a suspended tenant served long after platform-admin came
                // back and could have said so. Same rule, same reason, as isFeatureEnabled below.
                .onErrorResume(ex -> {
                    log.warn("[tenant-status] lookup failed for tenant={} — not caching; failOpen={}",
                            tenantId, failOpen, ex);
                    return Mono.just(StatusResolution.UNKNOWN);
                });
    }

    /**
     * Returns whether a feature is enabled for the tenant.
     * Uses Redis with platform-admin fallback (5-min TTL).
     * Redis key: {@code tenant_features:{tenantId}:{featureCode}}
     */
    private Mono<Boolean> isFeatureEnabled(UUID tenantId, String featureCode) {
        String key = "tenant_features:" + tenantId + ":" + featureCode;
        return redis.opsForValue().get(key)
                .map(val -> "true".equalsIgnoreCase(val))
                .switchIfEmpty(
                        platformAdminClient.getEnabledFeatures(tenantId)
                                .flatMap(enabled -> {
                                    boolean on = enabled.contains(featureCode);
                                    return redis.opsForValue()
                                            .set(key, String.valueOf(on), CACHE_TTL)
                                            .thenReturn(on);
                                })
                                // A failed lookup means "unknown", NOT "disabled" — never write it to
                                // Redis. Caching a guess turns a momentary platform-admin blip into a
                                // hard 403 for the full cache TTL, even though the DB says enabled.
                                .onErrorResume(ex -> {
                                    log.warn("[feature-flag] lookup failed for tenant={} feature={} "
                                            + "— not caching; failOpen={}", tenantId, featureCode, failOpen, ex);
                                    return Mono.just(failOpen);
                                })
                );
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
