package io.restaurantos.auth.controller;

import io.restaurantos.auth.service.ProvisioningAdminService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Internal endpoints for tenant provisioning and impersonation (platform-admin FD-1 + PLATFORM-05).
 * All paths are under /internal/auth/** which is already gated by the InternalServiceFilter
 * established in 03-03 — no SecurityConfig changes required.
 *
 * Doc 4 §4.2 surface:
 *   POST /internal/auth/tenants/{tenantId}/provision-admin
 *   POST /internal/auth/service-token
 *   POST /internal/auth/users/{userId}/impersonate
 */
@RestController
@RequestMapping("/internal/auth")
public class AuthProvisioningInternalController {

    private final ProvisioningAdminService provisioningAdminService;

    public AuthProvisioningInternalController(ProvisioningAdminService provisioningAdminService) {
        this.provisioningAdminService = provisioningAdminService;
    }

    /**
     * Creates the first Tenant Admin user in auth_db for the given tenant (FD-1 step 3).
     * Returns userId + tempPassword (one-time; caller must present to tenant admin out-of-band).
     */
    @PostMapping("/tenants/{tenantId}/provision-admin")
    public ResponseEntity<ApiResponse<Map<String, Object>>> provisionAdmin(
            @PathVariable UUID tenantId,
            @RequestBody ProvisionAdminRequest request) {
        ProvisioningAdminService.ProvisionAdminResult result =
            provisioningAdminService.provisionAdmin(tenantId, request.email());
        Map<String, Object> body = Map.of(
            "userId", result.userId().toString(),
            "tempPassword", result.tempPassword()
        );
        return ResponseEntity.status(201).body(ApiResponse.ok(body));
    }

    /**
     * Issues a short-lived service JWT (TTL 300s) for server-initiated internal calls (Doc 4 §4.1).
     */
    @PostMapping("/service-token")
    public ResponseEntity<ApiResponse<Map<String, Object>>> serviceToken(
            @RequestBody ServiceTokenRequest request) {
        String token = provisioningAdminService.signServiceToken(request.service());
        Map<String, Object> body = Map.of(
            "token", token,
            "expiresIn", 300
        );
        return ResponseEntity.ok(ApiResponse.ok(body));
    }

    /**
     * Issues a 30-minute impersonation JWT stamped with impersonated_by (PLATFORM-05).
     * Returns {token, expiresIn: 1800}.
     */
    @PostMapping("/users/{userId}/impersonate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> impersonate(
            @PathVariable UUID userId,
            @RequestBody ImpersonateRequest request) {
        ProvisioningAdminService.ImpersonateResult result =
            provisioningAdminService.impersonate(request.tenantId(), userId, request.impersonatedBy(), request.expiresInSeconds());
        Map<String, Object> body = Map.of(
            "token", result.token(),
            "expiresIn", result.expiresIn()
        );
        return ResponseEntity.ok(ApiResponse.ok(body));
    }

    record ProvisionAdminRequest(String email) {}
    record ServiceTokenRequest(String service) {}
    record ImpersonateRequest(UUID tenantId, UUID impersonatedBy, int expiresInSeconds) {}
}
