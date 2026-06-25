package io.restaurantos.gateway.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.UUID;

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
                               WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder
                .baseUrl(platformAdminUri)
                .defaultHeader("X-Internal-Service", "gateway")
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
                .bodyToMono(TenantStatusResponse.class)
                .map(TenantStatusResponse::status)
                .onErrorResume(ex -> {
                    if (failOpen) {
                        return Mono.just("ACTIVE");
                    }
                    return Mono.error(ex);
                });
    }

    /**
     * Fetches the list of enabled feature codes for a tenant from platform-admin.
     *
     * @return Mono emitting a comma-separated list of enabled FEATURE_* codes
     *         (e.g. "FEATURE_HR,FEATURE_CRM"), or empty string if none
     */
    public Mono<String> getFeaturesCsv(UUID tenantId) {
        return webClient.get()
                .uri(FEATURES_PATH, tenantId)
                .retrieve()
                .bodyToMono(TenantFeaturesResponse.class)
                .map(r -> String.join(",", r.enabledFeatures()))
                .onErrorResume(ex -> {
                    if (failOpen) {
                        return Mono.just("");
                    }
                    return Mono.error(ex);
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

    record TenantStatusResponse(String status) {}

    record TenantFeaturesResponse(java.util.List<String> enabledFeatures) {}

    record TenantSlugResponse(String tenantId) {}
}
