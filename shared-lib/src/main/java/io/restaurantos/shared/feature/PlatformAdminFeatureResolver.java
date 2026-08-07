package io.restaurantos.shared.feature;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Duration;

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

    /**
     * Connect timeout. A platform-admin that is unreachable must fail this call in seconds, not
     * hold the caller's request thread indefinitely.
     */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);

    /**
     * Read timeout. This is a single indexed lookup returning a small map; anything approaching
     * this bound means platform-admin is in trouble, and waiting longer only spreads that trouble
     * to the caller.
     */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(3);

    /**
     * @param platformAdminUri base URI of platform-admin-service
     * @param internalSecret   the shared secret for {@code /internal/**}
     *
     * <p><b>The timeouts are not optional.</b> This client had none, and
     * {@link #enabledFeatures} is called on the request path of every feature-gated route in
     * every service. When platform-admin-service was restarted, a thread dump showed 39 Tomcat
     * workers parked here on an exhausted connection pool, permanently wedging pos-service and
     * inventory-service — while {@code /actuator/health}, which makes no such call, stayed green,
     * so nothing restarted them.
     *
     * <p>This is the second instance of the same defect: {@code JwksKeyProvider} held a monitor
     * across an equally unbounded call and took four services down the same way. A shared HTTP
     * client with no timeout is not a slow dependency, it is a distributed deadlock waiting for a
     * restart of the service it depends on.
     */
    public PlatformAdminFeatureResolver(String platformAdminUri, String internalSecret) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT);
        factory.setReadTimeout(READ_TIMEOUT);
        this.restClient = RestClient.builder()
                .requestFactory(factory)
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
