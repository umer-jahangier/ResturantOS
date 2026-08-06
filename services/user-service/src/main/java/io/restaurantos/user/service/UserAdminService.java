package io.restaurantos.user.service;

import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.client.AuthInternalClient;
import io.restaurantos.user.dto.BranchDtos;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/**
 * Tenant-Admin user surface (USER-02).
 * Per-branch role assignment DELEGATES to AuthInternalClient — auth-service is the SYSTEM OF RECORD
 * for user_branch_roles. This service NEVER writes that table directly.
 */
@Service
public class UserAdminService {

    private final AuthInternalClient authInternalClient;
    private final TenantContext tenantContext;

    public UserAdminService(AuthInternalClient authInternalClient, TenantContext tenantContext) {
        this.authInternalClient = authInternalClient;
        this.tenantContext = tenantContext;
    }

    /**
     * Assign a role to a user at a branch — delegates to auth-service.
     *
     * <p>Forwards the CALLER's identity (13-11). auth-service refuses a grant whose permission set
     * exceeds the acting user's own, and it recomputes that set server-side rather than trusting
     * anything sent here — so this header is an identity, not a claim of authority. The value is
     * the subject of the verified JWT, taken from {@link TenantContext}, which
     * {@code JwtAuthenticationFilter} populated; it is never read from the request.
     *
     * <p>An authenticated request always carries a subject, so the absence of one is a broken
     * filter chain rather than an anonymous caller. It is refused HERE with a clear message rather
     * than forwarded as a null header — auth-service would refuse it anyway
     * ({@code 403 ACTING_USER_REQUIRED}), and a refusal that names the real cause is worth the
     * three lines.
     */
    public Map<String, Object> assignRole(UUID userId, BranchDtos.BranchRoleRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = tenantContext.getUserId().orElseThrow(() -> new IllegalStateException(
            "No authenticated user id in the request context; a role assignment must name the "
                + "person making it (auth-service bounds the grant by their own permissions)"));
        return authInternalClient.assignBranchRole(userId, tenantId, actingUserId, request);
    }

    /**
     * Revoke a branch-role from a user — delegates to auth-service.
     */
    public void revokeRole(UUID userId, UUID branchId, String roleCode) {
        UUID tenantId = tenantContext.requireTenantId();
        authInternalClient.revokeBranchRole(userId, tenantId, branchId, roleCode);
    }

    /**
     * Fetch computed permissions for a user at a branch — read-through to auth-service.
     * Used for JWT-feeding lookups; auth-service is authoritative.
     */
    public Map<String, Object> getUserPermissions(UUID userId, UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.getUserPermissions(userId, tenantId, branchId);
    }
}
