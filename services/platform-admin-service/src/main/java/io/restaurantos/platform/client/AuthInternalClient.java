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

    @PostMapping("/internal/auth/users/{userId}/impersonate")
    Map<String, Object> impersonate(@PathVariable UUID userId,
                                    @RequestBody Map<String, Object> request);
}
