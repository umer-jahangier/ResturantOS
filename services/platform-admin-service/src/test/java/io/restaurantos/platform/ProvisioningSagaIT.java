package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.service.ProvisioningService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies the complete provisioning saga (SC3 / PLATFORM-01).
 */
class ProvisioningSagaIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;

    @Test
    void provisionTenant_happyPath_tenantActiveWithinSixtySeconds() {
        UUID adminUserId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();

        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + adminUserId + "\",\"tempPassword\":\"Temp#Pass123\"}}")));
        stubUserCreateBranch(branchId);

        long start = System.currentTimeMillis();
        var result = provisioningService.provision(
            "happy-" + UUID.randomUUID(), "IT Happy Restaurant", "admin@happy.local", "GROWTH");
        long elapsed = System.currentTimeMillis() - start;

        assertThat(elapsed).isLessThan(60_000L);
        assertThat(result.tenantId()).isNotNull();
        assertThat(result.slug()).isNotBlank();

        var tenant = tenantRepository.findById(result.tenantId()).orElseThrow();
        assertThat(tenant.getStatus()).isEqualTo(TenantStatus.ACTIVE);

        List<Map<String, Object>> features = jdbc.queryForList(
            "SELECT feature_code, is_enabled FROM tenant_features WHERE tenant_id = ?",
            result.tenantId());
        assertThat(features).isNotEmpty();

        Map<String, Object> pos = features.stream()
            .filter(f -> "FEATURE_POS".equals(f.get("feature_code"))).findFirst().orElse(null);
        assertThat(pos).isNotNull();
        assertThat(pos.get("is_enabled")).isEqualTo(Boolean.TRUE);

        Map<String, Object> multiBranch = features.stream()
            .filter(f -> "FEATURE_MULTI_BRANCH".equals(f.get("feature_code"))).findFirst().orElse(null);
        assertThat(multiBranch).isNotNull();
        assertThat(multiBranch.get("is_enabled")).isEqualTo(Boolean.TRUE);

        List<Map<String, Object>> outboxRows = jdbc.queryForList(
            "SELECT event_type FROM event_outbox WHERE tenant_id = ?", result.tenantId());
        assertThat(outboxRows).extracting(r -> r.get("event_type")).contains("TENANT_PROVISIONED");
    }

    @Test
    void provisionTenant_idempotent_replayReturnsSameTenant() {
        String idempotencyKey = "idem-" + UUID.randomUUID();

        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + UUID.randomUUID() + "\",\"tempPassword\":\"Tmp#123\"}}")));
        stubUserCreateBranch(UUID.randomUUID());

        var first = provisioningService.provision(idempotencyKey, "Idem Brand", "admin@idem.local", "STARTER");
        var second = provisioningService.provision(idempotencyKey, "Idem Brand", "admin@idem.local", "STARTER");

        assertThat(second.tenantId()).isEqualTo(first.tenantId());
        assertThat(second.slug()).isEqualTo(first.slug());

        long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM tenants WHERE id = ?", Long.class, first.tenantId());
        assertThat(count).isEqualTo(1L);
    }

    @Test
    void provisionTenant_branchFails_compensates_tenantProvisioningFailed() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + UUID.randomUUID() + "\",\"tempPassword\":\"Tmp#123\"}}")));
        stubUserCreateBranchFail();

        String key = "comp-" + UUID.randomUUID();

        assertThatThrownBy(() -> provisioningService.provision(
                key, "Compensation Brand", "admin@comp.local", "STARTER"))
            .isInstanceOf(ProvisioningService.ProvisioningException.class);

        var tenants = tenantRepository.findAll().stream()
            .filter(t -> "Compensation Brand".equals(t.getBrandName()))
            .toList();
        assertThat(tenants).isNotEmpty();
        assertThat(tenants.get(0).getStatus()).isEqualTo(TenantStatus.PROVISIONING_FAILED);

        List<Map<String, Object>> events = jdbc.queryForList(
            "SELECT event_type FROM event_outbox WHERE tenant_id = ?",
            tenants.get(0).getId());
        assertThat(events).extracting(r -> r.get("event_type")).doesNotContain("TENANT_PROVISIONED");
    }
}
