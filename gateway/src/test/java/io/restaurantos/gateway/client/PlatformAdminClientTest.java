package io.restaurantos.gateway.client;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.test.StepVerifier;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression tests for the gateway → platform-admin internal seam.
 *
 * <p>Three defects made every feature-gated route return 403 FEATURE_DISABLED regardless of the
 * tenant's actual flags:
 * <ol>
 *   <li>the client was pointed at port 8083 (authorization-service), not platform-admin;</li>
 *   <li>it sent {@code X-Internal-Service: gateway} instead of the shared secret, so every call
 *       was rejected with INTERNAL_AUTH_REQUIRED;</li>
 *   <li>it deserialised the payload without platform-admin's {@code ApiResponse} envelope, so the
 *       feature list came back null/empty even on a 200.</li>
 * </ol>
 * The bodies below are the real responses captured from a running platform-admin-service.
 */
class PlatformAdminClientTest {

    private static final UUID TENANT = UUID.fromString("dbd114d2-f5e2-520d-8d6c-dab6076771b9");
    private static final String SECRET = "test-internal-secret";

    /** Verbatim from GET /internal/platform/tenants/{id}/features on a live platform-admin. */
    private static final String FEATURES_BODY = """
            {"data":{"features":{"FEATURE_POS":true,"FEATURE_INVENTORY":true,"FEATURE_FINANCE":true,\
            "FEATURE_VENDOR":true,"FEATURE_HR":true,"FEATURE_KDS":true,\
            "FEATURE_WHITE_LABEL_DOMAIN":false,"FEATURE_CONSOLIDATED_REPORTING":false}},\
            "meta":null,"warnings":[]}""";

    /** Verbatim from GET /internal/platform/tenants/{id}/status. */
    private static final String STATUS_BODY =
            "{\"data\":{\"status\":\"ACTIVE\",\"tier\":\"GROWTH\"},\"meta\":null,\"warnings\":[]}";

    private MockWebServer platformAdmin;
    private PlatformAdminClient client;

    @BeforeEach
    void setUp() throws Exception {
        platformAdmin = new MockWebServer();
        platformAdmin.start();
        client = new PlatformAdminClient(
                platformAdmin.url("/").toString().replaceAll("/$", ""),
                SECRET,
                WebClient.builder());
        ReflectionTestUtils.setField(client, "failOpen", false);
    }

    @AfterEach
    void tearDown() throws Exception {
        platformAdmin.shutdown();
    }

    @Test
    void parsesTheApiResponseEnvelopeAndReturnsOnlyEnabledFeatures() {
        platformAdmin.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(FEATURES_BODY));

        StepVerifier.create(client.getEnabledFeatures(TENANT))
                .assertNext(features -> {
                    // The bug: this came back empty, so the filter concluded "disabled" and cached false.
                    assertThat(features).contains("FEATURE_VENDOR");
                    assertThat(features).containsExactlyInAnyOrderElementsOf(Set.of(
                            "FEATURE_POS", "FEATURE_INVENTORY", "FEATURE_FINANCE",
                            "FEATURE_VENDOR", "FEATURE_HR", "FEATURE_KDS"));
                    // Explicitly-disabled flags must not leak through as enabled.
                    assertThat(features).doesNotContain(
                            "FEATURE_WHITE_LABEL_DOMAIN", "FEATURE_CONSOLIDATED_REPORTING");
                })
                .verifyComplete();
    }

    @Test
    void sendsTheSharedSecretAsTheInternalServiceHeader() throws Exception {
        platformAdmin.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(FEATURES_BODY));

        client.getEnabledFeatures(TENANT).block();

        RecordedRequest request = platformAdmin.takeRequest();
        // Previously the literal string "gateway" — which platform-admin rejects with 403.
        assertThat(request.getHeader("X-Internal-Service")).isEqualTo(SECRET);
        assertThat(request.getPath()).isEqualTo("/internal/platform/tenants/" + TENANT + "/features");
    }

    @Test
    void parsesTenantStatusThroughTheEnvelope() {
        platformAdmin.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(STATUS_BODY));

        StepVerifier.create(client.getStatus(TENANT))
                .expectNext("ACTIVE")
                .verifyComplete();
    }

    @Test
    void propagatesLookupFailuresInsteadOfReportingZeroFeatures() {
        // A rejected/failed call must surface as an error so the caller can tell "cannot verify"
        // from "tenant has no features" — conflating them is what produced the false 403.
        platformAdmin.enqueue(new MockResponse().setResponseCode(403));

        StepVerifier.create(client.getEnabledFeatures(TENANT))
                .expectError()
                .verify();
    }
}
