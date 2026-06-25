package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.platform.service.ProvisioningService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Feature-flag dual-key Redis invalidation (SC6 / PLATFORM-04 / PLATFORM-10).
 */
class FeatureFlagInvalidationIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;
    @Autowired FeatureFlagAdminService featureFlagAdminService;

    @Test
    void setFeature_enableAboveTier_bothRedisKeyShapesSetImmediately() {
        UUID tenantId = provisionTenantDirect("FF Brand Enable", "STARTER");

        String code = "FEATURE_WHATSAPP_NOTIFICATIONS";
        featureFlagAdminService.setFeature(tenantId, code, true);

        boolean dbValue = jdbc.queryForObject(
            "SELECT is_enabled FROM tenant_features WHERE tenant_id = ? AND feature_code = ?",
            Boolean.class, tenantId, code);
        assertThat(dbValue).isTrue();

        // Both Redis key shapes must show "true" immediately
        assertThat(redis.opsForValue().get("tenant_features:" + tenantId + ":" + code)).isEqualTo("true");
        assertThat(redis.opsForValue().get("feature:" + tenantId + ":" + code)).isEqualTo("true");
    }

    @Test
    void setFeature_revokeDefaultOnFeature_bothRedisKeyShapesSetFalseImmediately() {
        UUID tenantId = provisionTenantDirect("FF Brand Revoke", "STARTER");

        String code = "FEATURE_HR";
        featureFlagAdminService.setFeature(tenantId, code, false);

        boolean dbValue = jdbc.queryForObject(
            "SELECT is_enabled FROM tenant_features WHERE tenant_id = ? AND feature_code = ?",
            Boolean.class, tenantId, code);
        assertThat(dbValue).isFalse();

        // BOTH keys show "false" immediately (not null — null would be ambiguous)
        assertThat(redis.opsForValue().get("tenant_features:" + tenantId + ":" + code)).isEqualTo("false");
        assertThat(redis.opsForValue().get("feature:" + tenantId + ":" + code)).isEqualTo("false");
    }

    @Test
    void setFeature_noTTLWait_redisKeyPresentImmediately() {
        UUID tenantId = provisionTenantDirect("FF Brand TTL", "GROWTH");
        String code = "FEATURE_CONSOLIDATED_REPORTING";

        featureFlagAdminService.setFeature(tenantId, code, true);

        // Keys present immediately — not needing a background write or TTL wait
        assertThat(redis.opsForValue().get("tenant_features:" + tenantId + ":" + code)).isNotNull();
        assertThat(redis.opsForValue().get("feature:" + tenantId + ":" + code)).isNotNull();
    }

    // --- helpers ---

    private UUID provisionTenantDirect(String brandName, String tier) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
            .willReturn(WireMock.aResponse().withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + UUID.randomUUID() + "\",\"tempPassword\":\"T#123\"}}")));
        stubUserCreateBranch(UUID.randomUUID());
        return provisioningService.provision("ff-" + UUID.randomUUID(), brandName, "admin@ff.local", tier).tenantId();
    }
}
