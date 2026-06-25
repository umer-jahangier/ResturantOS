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
     */
    public Map<String, Object> assignRole(UUID userId, BranchDtos.BranchRoleRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.assignBranchRole(userId, tenantId, request);
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
        return authInternalClient.getUserPermissions(userId, branchId);
    }
}
