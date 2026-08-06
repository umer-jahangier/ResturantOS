package io.restaurantos.auth.controller;

import io.restaurantos.auth.service.AuthTenantProvisioningService;
import io.restaurantos.auth.service.ProvisioningAdminService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Internal endpoints for tenant provisioning and impersonation (platform-admin FD-1 + PLATFORM-05).
 * All paths are under /internal/auth/** which is already gated by the InternalServiceFilter
 * established in 03-03 — no SecurityConfig changes required. The gateway deliberately maps NO route
 * to /internal/**, so the shared secret is the whole of the authorization here and these endpoints
 * are unreachable from outside.
 *
 * Doc 4 §4.2 surface, as extended by plan 13-06 to close blocker B2:
 *   POST  /internal/auth/tenants                              — 13-06 (D-04)
 *   PATCH /internal/auth/tenants/{tenantId}/status            — 13-06 (D-04)
 *   POST  /internal/auth/tenants/{tenantId}/provision-admin   — extended by 13-06 (D-05, D-13)
 *   POST  /internal/auth/service-token
 *   POST  /internal/auth/users/{userId}/impersonate
 */
@RestController
@RequestMapping("/internal/auth")
public class AuthProvisioningInternalController {

    private final ProvisioningAdminService provisioningAdminService;
    private final AuthTenantProvisioningService authTenantProvisioningService;

    public AuthProvisioningInternalController(ProvisioningAdminService provisioningAdminService,
                                              AuthTenantProvisioningService authTenantProvisioningService) {
        this.provisioningAdminService = provisioningAdminService;
        this.authTenantProvisioningService = authTenantProvisioningService;
    }

    /**
     * Register (upsert) the auth-side tenant row that login resolves by slug — D-04, blocker B2.
     *
     * <p>Deliberately answers 200 on both create and update. A retried saga step should not have to
     * treat 201 and 200 as two different successes, and an upsert is not a creation on its replay;
     * the {@code created} flag in the body carries that distinction for anyone who wants it.
     */
    @PostMapping("/tenants")
    public ResponseEntity<ApiResponse<Map<String, Object>>> registerTenant(
            @Valid @RequestBody RegisterTenantRequest request) {
        AuthTenantProvisioningService.RegisterResult result =
            authTenantProvisioningService.register(request.tenantId(), request.slug(), request.name());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tenantId", result.tenantId().toString());
        body.put("slug", result.slug());
        body.put("name", result.name());
        body.put("status", result.status());
        body.put("created", result.created());
        return ResponseEntity.ok(ApiResponse.ok(body));
    }

    /**
     * Apply a platform tenant status to the auth-side row. The request carries the PLATFORM
     * vocabulary; the mapping onto what login accepts lives in one place in the service.
     */
    @PatchMapping("/tenants/{tenantId}/status")
    public ResponseEntity<ApiResponse<Map<String, Object>>> setTenantStatus(
            @PathVariable UUID tenantId,
            @Valid @RequestBody TenantStatusRequest request) {
        AuthTenantProvisioningService.StatusResult result =
            authTenantProvisioningService.setStatus(tenantId, request.status());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tenantId", result.tenantId().toString());
        body.put("slug", result.slug());
        body.put("status", result.status());
        body.put("loginAllowed", result.loginAllowed());
        return ResponseEntity.ok(ApiResponse.ok(body));
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

    record RegisterTenantRequest(@NotNull UUID tenantId, @NotBlank String slug, String name) {}
    record TenantStatusRequest(@NotBlank String status) {}
    record ProvisionAdminRequest(String email) {}
    record ServiceTokenRequest(String service) {}
    record ImpersonateRequest(UUID tenantId, UUID impersonatedBy, int expiresInSeconds) {}
}
