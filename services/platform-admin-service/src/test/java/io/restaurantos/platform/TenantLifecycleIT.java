package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.TenantLifecycleService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lifecycle state machine tests (PLATFORM-02/03).
 */
class TenantLifecycleIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;
    @Autowired TenantLifecycleService lifecycleService;

    @Test
    void suspend_activeToSuspended_updatesDbAndRedis() {
        UUID tenantId = provisionTenantDirect("Lifecycle Brand Suspend");

        var suspended = lifecycleService.suspend(tenantId, "billing overdue");

        assertThat(suspended.getStatus()).isEqualTo(TenantStatus.SUSPENDED);
        assertThat(suspended.getSuspendedAt()).isNotNull();

        // Redis status key set immediately after suspend
        String redisKey = "tenant:status:" + tenantId;
        assertThat(redis.opsForValue().get(redisKey)).isEqualTo("SUSPENDED");
    }

    @Test
    void reactivate_suspendedToActive_updatesDbAndRedis() {
        UUID tenantId = provisionTenantDirect("Lifecycle Brand Reactivate");

        lifecycleService.suspend(tenantId, "test");
        var reactivated = lifecycleService.reactivate(tenantId);

        assertThat(reactivated.getStatus()).isEqualTo(TenantStatus.ACTIVE);
        assertThat(reactivated.getSuspendedAt()).isNull();

        String redisKey = "tenant:status:" + tenantId;
        assertThat(redis.opsForValue().get(redisKey)).isEqualTo("ACTIVE");
    }

    @Test
    void cancel_activeToCanelled_setsCancelledAt() {
        UUID tenantId = provisionTenantDirect("Lifecycle Brand Cancel");

        var cancelled = lifecycleService.cancel(tenantId, "user requested");

        assertThat(cancelled.getStatus()).isEqualTo(TenantStatus.CANCELLED);
        assertThat(cancelled.getCancelledAt()).isNotNull();
    }

    @Test
    void invalidTransition_reactivateCancelled_throwsIllegalState() {
        UUID tenantId = provisionTenantDirect("Lifecycle Brand Invalid");

        lifecycleService.cancel(tenantId, "test");

        assertThatThrownBy(() -> lifecycleService.reactivate(tenantId))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("CANCELLED");
    }

    @Test
    void invalidTransition_suspendSuspended_throwsIllegalState() {
        UUID tenantId = provisionTenantDirect("Lifecycle Brand Suspend2");

        lifecycleService.suspend(tenantId, "first");

        assertThatThrownBy(() -> lifecycleService.suspend(tenantId, "second"))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void internalStatusEndpoint_returnsStatusAndTier() {
        UUID tenantId = provisionTenantDirect("Lifecycle Status Endpoint");

        var response = httpGetInternal("/internal/platform/tenants/" + tenantId + "/status");
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("ACTIVE");
        assertThat(response.getBody()).contains("STARTER");
    }

    // --- helpers ---

    private UUID provisionTenantDirect(String brandName) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
            .willReturn(WireMock.aResponse().withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + UUID.randomUUID() + "\",\"tempPassword\":\"T#123\"}}")));
        stubUserCreateBranch(UUID.randomUUID());
        return provisioningService.provision("lc-" + UUID.randomUUID(), brandName, "admin@lc.local", "STARTER").tenantId();
    }
}
