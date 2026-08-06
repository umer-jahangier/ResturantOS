package io.restaurantos.platform.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
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

    /**
     * Register (upsert) the auth-side tenant row that login resolves by slug — 13-06 / D-04.
     *
     * <p>Answers <b>200 on create and on replay</b>, never 201, and never touches {@code status} on
     * a replay. Raises <b>409 STATE_INVALID</b> when the slug is held by a different tenant, which
     * is why the saga calls this <i>before</i> creating any user: a slug collision then costs
     * nothing to undo.
     */
    @PostMapping("/internal/auth/tenants")
    RegisterTenantResponse registerTenant(@RequestBody RegisterTenantRequest request);

    /**
     * Apply a platform tenant status to the auth-side row (13-06 / D-04). The body carries the
     * PLATFORM vocabulary; auth-service owns the mapping onto what login accepts. Used by the saga
     * as the compensating action for {@link #registerTenant}: a tenant marked
     * {@code PROVISIONING_FAILED} cannot be logged into.
     */
    @PatchMapping("/internal/auth/tenants/{tenantId}/status")
    Map<String, Object> setTenantStatus(@PathVariable UUID tenantId,
                                        @RequestBody TenantStatusRequest request);

    /**
     * Create the first tenant admin — the user AND the branch-role assignment that makes the
     * account usable (13-06 / D-05).
     *
     * <p><b>{@code branchId} and {@code roleCode} are REQUIRED.</b> 13-06 made that a breaking
     * change on purpose: accepting {@code {email}} alone manufactures an account with no branch
     * assignment, which is precisely the locked-out tenant blocker B2 is about.
     *
     * <p>The response's {@code tempPassword} is one-time credential material. It exists in the
     * response and nowhere else — never logged here, never persisted plaintext, never evented.
     */
    @PostMapping("/internal/auth/tenants/{tenantId}/provision-admin")
    ProvisionAdminResponse provisionAdmin(@PathVariable UUID tenantId,
                                          @RequestBody ProvisionAdminRequest request);

    /**
     * Revoke (soft-deactivate) a branch-role assignment. The saga's compensating action for
     * {@link #provisionAdmin}: an admin stripped of its only assignment cannot resolve permissions
     * and cannot log in. Idempotent on the producer side ({@code revoke} is a no-op when the row is
     * absent), so a retried compensation cannot fail on its second run.
     */
    @DeleteMapping("/internal/auth/users/{userId}/branch-roles")
    void revokeBranchRole(@PathVariable UUID userId,
                          @RequestHeader("X-Tenant-Id") UUID tenantId,
                          @RequestParam UUID branchId,
                          @RequestParam String roleCode);

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

    // --- Typed contracts (13-06's shapes, coded against by 13-10) ---

    record RegisterTenantRequest(UUID tenantId, String slug, String name) {}

    record TenantStatusRequest(String status) {}

    /**
     * {@code fullName} is optional at the producer; it is sent as null by the saga because a
     * provisioning request carries a brand and an email, not a person's name, and a placeholder
     * would be indistinguishable from one the admin chose.
     */
    record ProvisionAdminRequest(String email, UUID branchId, String roleCode, String fullName) {}

    /** These two are the ApiResponse envelope auth-service wraps its internal bodies in. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record RegisterTenantResponse(RegisterTenantData data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record RegisterTenantData(UUID tenantId, String slug, String name, String status, Boolean created) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProvisionAdminResponse(ProvisionAdminData data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProvisionAdminData(UUID userId, String tempPassword, UUID branchId, String roleCode,
                              Boolean mustChangePassword) {
        /**
         * Never let a temp password reach a log through an accidental {@code toString()} — a record
         * prints every component by default, and this one is the credential the whole saga exists
         * to hand over exactly once.
         */
        @Override
        public String toString() {
            return "ProvisionAdminData[userId=" + userId + ", branchId=" + branchId
                + ", roleCode=" + roleCode + ", tempPassword=<redacted>]";
        }
    }
}
