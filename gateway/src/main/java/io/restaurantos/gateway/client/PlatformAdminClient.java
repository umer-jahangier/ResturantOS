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
 * <h3>Fail-open / fail-closed seam:</h3>
 * <p>This client reports what platform-admin said, or fails. It does not decide what a failure means
 * — {@code restaurantos.fail-open-on-platform-down} is read and acted on in exactly one place,
 * {@link io.restaurantos.gateway.filter.FeatureFlagGlobalFilter}, which turns an unreachable
 * platform-admin into 503 TENANT_STATUS_UNAVAILABLE (default) or lets the request through (only when
 * the lever is explicitly pulled).
 *
 * <p>Substituting a plausible answer here instead — which {@link #getStatus} used to do, returning
 * {@code "ACTIVE"} on any error under fail-open — hides the failure from the only component able to
 * act on it, and hands it a value indistinguishable from a real determination, which it will then
 * cache. See the note on {@link #getStatus}.
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
     * <p>Errors are NOT swallowed here, for the same reason {@link #getEnabledFeatures} does not
     * swallow them: the caller must be able to tell "platform-admin says this tenant is ACTIVE" apart
     * from "we could not reach platform-admin". This method used to answer {@code "ACTIVE"} on any
     * error when fail-open was enabled, and that was wrong in two compounding ways. It applied the
     * fail-open lever in a second place — so the filter, which also applies it, could not see that a
     * decision had already been made on its behalf. And because the fabricated {@code "ACTIVE"} was
     * indistinguishable from a real answer, the filter cached it: one blip, and a suspended tenant is
     * served from Redis for the next five minutes, including after fail-open is turned back off.
     *
     * <p>The lever now lives in exactly one place, {@code FeatureFlagGlobalFilter}, which is the only
     * component that both knows an answer is missing and is in a position to decide what to do about
     * it.
     *
     * @return Mono emitting "ACTIVE", "SUSPENDED", or "CANCELLED"
     */
    public Mono<String> getStatus(UUID tenantId) {
        return webClient.get()
                .uri(STATUS_PATH, tenantId)
                .retrieve()
                .bodyToMono(StatusEnvelope.class)
                .map(env -> env.data().status());
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
