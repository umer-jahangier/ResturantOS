package io.restaurantos.file.client;

import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.util.UUID;

/**
 * Feign client for platform-admin-service internal API.
 * Used by QuotaService to retrieve the tenant's storage tier and derive the storage limit.
 *
 * The GET /internal/platform/tenants/{id}/status endpoint returns {status, tier}.
 * Storage limit is derived from tier using configurable defaults in application.yml.
 * If platform-admin is unreachable, QuotaService FAILS CLOSED (rejects the upload).
 */
@FeignClient(
    name = "platform-admin-service",
    url = "${restaurantos.platform-admin-service.uri}",
    configuration = FeignSharedConfig.class
)
public interface PlatformAdminClient {

    @GetMapping("/internal/platform/tenants/{tenantId}/status")
    ApiResponse<TenantStatusResponse> getTenantStatus(@PathVariable UUID tenantId);

    record TenantStatusResponse(String status, String tier) {}
}
