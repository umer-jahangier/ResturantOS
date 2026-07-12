package io.restaurantos.gateway.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Reactive WebClient for platform-admin-service internal endpoints.
 *
 * <p>Used by the gateway as a cache-miss fallback for:
 * <ul>
 *   <li>{@code GET /internal/platform/tenants/{id}/status} — tenant lifecycle status</li>
 *   <li>{@code GET /internal/platform/tenants/{id}/features} — enabled feature codes</li>
 *   <li>{@code GET /internal/platform/tenants/slug/{slug}} — resolve slug → tenantId</li>
 * </ul>
 *
 * <h3>Fail-open / fail-closed seam (documented for 03-02):</h3>
 * <p>When {@code restaurantos.fail-open-on-platform-down=true} (dev profile only):
 * connection failures are swallowed and the request proceeds as if the tenant is ACTIVE
 * with no feature restrictions. In production ({@code false}), connection failures
 * propagate and result in 403.
 *
 * <p>platform-admin-service is built in plan 03-02; until then these calls will fail.
 * The {@code onErrorResume} wrappers in {@link io.restaurantos.gateway.filter.FeatureFlagGlobalFilter}
 * handle that gracefully per the fail-open/closed setting.
 */
@Component
public class PlatformAdminClient {

    private static final String STATUS_PATH = "/internal/platform/tenants/{id}/status";
    private static final String FEATURES_PATH = "/internal/platform/tenants/{id}/features";
    private static final String SLUG_PATH = "/internal/platform/tenants/slug/{slug}";

    private final WebClient webClient;

    @Value("${restaurantos.fail-open-on-platform-down:false}")
    private boolean failOpen;

    public PlatformAdminClient(@Value("${restaurantos.platform-admin.uri}") String platformAdminUri,
                               @Value("${restaurantos.internal.secret}") String internalSecret,
                               WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder
                .baseUrl(platformAdminUri)
                // platform-admin compares this against INTERNAL_SERVICE_SECRET — it must be the
                // secret itself, not a service name, or every internal call is rejected.
                .defaultHeader("X-Internal-Service", internalSecret)
                .build();
    }

    /**
     * Fetches the tenant lifecycle status from platform-admin.
     *
     * @return Mono emitting "ACTIVE", "SUSPENDED", or "CANCELLED"
     */
    public Mono<String> getStatus(UUID tenantId) {
        return webClient.get()
                .uri(STATUS_PATH, tenantId)
                .retrieve()
                .bodyToMono(StatusEnvelope.class)
                .map(env -> env.data().status())
                .onErrorResume(ex -> {
                    if (failOpen) {
                        return Mono.just("ACTIVE");
                    }
                    return Mono.error(ex);
                });
    }

    /**
     * Fetches the enabled feature codes for a tenant from platform-admin.
     *
     * <p>Errors are NOT swallowed here: the caller must be able to tell "platform-admin said this
     * tenant has no features" apart from "we could not reach platform-admin". Conflating the two
     * is what turns a transient outage into a hard 403 FEATURE_DISABLED.
     *
     * @return Mono emitting the set of enabled FEATURE_* codes (possibly empty)
     */
    public Mono<Set<String>> getEnabledFeatures(UUID tenantId) {
        return webClient.get()
                .uri(FEATURES_PATH, tenantId)
                .retrieve()
                .bodyToMono(FeaturesEnvelope.class)
                .map(env -> {
                    Map<String, Boolean> features = env.data().features();
                    if (features == null) {
                        return Set.<String>of();
                    }
                    return features.entrySet().stream()
                            .filter(Map.Entry::getValue)
                            .map(Map.Entry::getKey)
                            .collect(Collectors.toUnmodifiableSet());
                });
    }

    /**
     * Resolves a tenant slug to its UUID via platform-admin (cache-miss path).
     *
     * @return Mono emitting the tenant UUID
     */
    public Mono<UUID> getTenantIdBySlug(String slug) {
        return webClient.get()
                .uri(SLUG_PATH, slug)
                .retrieve()
                .bodyToMono(TenantSlugResponse.class)
                .map(r -> UUID.fromString(r.tenantId()))
                .onErrorResume(ex -> {
                    if (failOpen) {
                        return Mono.error(new IllegalStateException(
                                "Slug resolution failed (fail-open: slug=" + slug + ")", ex));
                    }
                    return Mono.error(ex);
                });
    }

    // ── Internal response DTOs ───────────────────────────────────────────────
    // platform-admin wraps every response in the shared ApiResponse envelope
    // ({"data":{...},"meta":null,"warnings":[]}), so each DTO models `data` explicitly.
    // Deserialising the payload directly (without the envelope) yields all-null fields.

    @JsonIgnoreProperties(ignoreUnknown = true)
    record StatusEnvelope(StatusData data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record StatusData(String status, String tier) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record FeaturesEnvelope(FeaturesData data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record FeaturesData(Map<String, Boolean> features) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record TenantSlugResponse(String tenantId) {}
}
