package io.restaurantos.shared.feature;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.web.client.RestClient;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Resolves tenant feature flags from platform-admin-service, which owns the {@code tenant_features}
 * table (PLATFORM-10).
 *
 * <p>Calls {@code GET /internal/platform/tenants/{id}/features}, authenticating with the shared
 * {@code X-Internal-Service} secret. The response is wrapped in the standard {@code ApiResponse}
 * envelope and carries a {@code Map<featureCode, enabled>}, so both the envelope and the map are
 * modelled explicitly here.
 */
public class PlatformAdminFeatureResolver implements TenantFeatureResolver {

    private static final String FEATURES_PATH = "/internal/platform/tenants/{id}/features";

    private final RestClient restClient;

    public PlatformAdminFeatureResolver(String platformAdminUri, String internalSecret) {
        this.restClient = RestClient.builder()
                .baseUrl(platformAdminUri)
                .defaultHeader("X-Internal-Service", internalSecret)
                .build();
    }

    @Override
    public Set<String> enabledFeatures(UUID tenantId) {
        FeaturesEnvelope envelope = restClient.get()
                .uri(FEATURES_PATH, tenantId)
                .retrieve()
                .body(FeaturesEnvelope.class);

        if (envelope == null || envelope.data() == null || envelope.data().features() == null) {
            throw new IllegalStateException(
                    "platform-admin returned no feature map for tenant " + tenantId);
        }
        return envelope.data().features().entrySet().stream()
                .filter(Map.Entry::getValue)
                .map(Map.Entry::getKey)
                .collect(Collectors.toUnmodifiableSet());
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record FeaturesEnvelope(FeaturesData data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record FeaturesData(Map<String, Boolean> features) {}
}
