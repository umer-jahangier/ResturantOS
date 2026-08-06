package io.restaurantos.platform.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Feign client for auth-service internal provisioning/impersonation endpoints (Doc 4 §4.2).
 * Called by TenantProvisioningService (FD-1 step 3) and ImpersonationService.
 */
@FeignClient(
    name = "auth-service",
    url = "${restaurantos.auth-service.uri:}",
    configuration = FeignSharedConfig.class
)
public interface AuthInternalClient {

    @PostMapping("/internal/auth/tenants/{tenantId}/provision-admin")
    Map<String, Object> provisionAdmin(@PathVariable UUID tenantId,
                                       @RequestBody Map<String, String> request);

    @PostMapping("/internal/auth/service-token")
    Map<String, Object> serviceToken(@RequestBody Map<String, String> request);

    /**
     * Mint a tenant-less control-plane token for a platform user (added by plan 13-01, consumed by
     * 13-05's login).
     *
     * <p>This is the second hop of a platform login and the split is PLATFORM-07: platform-admin
     * -service verifies the credential because it is the only service permitted to read {@code
     * platform_db}, and auth-service signs the token because it holds the RSA private key and owns
     * the JWKS contract. auth-service performs no lookup and no password check here — it signs what
     * this service asserts, authorized by the {@code X-Internal-Service} secret that
     * {@link FeignSharedConfig} attaches.
     *
     * <p>Body: {@code {platformUserId, platformRole}}. Response:
     * {@code {"data":{"token","expiresIn","tokenType"}}}.
     */
    @PostMapping("/internal/auth/platform-token")
    Map<String, Object> platformToken(@RequestBody Map<String, String> request);

    @PostMapping("/internal/auth/users/{userId}/impersonate")
    Map<String, Object> impersonate(@PathVariable UUID userId,
                                    @RequestBody Map<String, Object> request);
}
