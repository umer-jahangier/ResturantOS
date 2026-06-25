package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.service.BranchRoleAdminService;
import io.restaurantos.auth.service.PermissionResolver;
import io.restaurantos.auth.service.ResolvedBranchAuth;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Internal-only endpoints called by trusted platform services (not public gateway traffic).
 * All paths under /internal/auth/** are gated by InternalServiceFilter (X-Internal-Service header).
 * See Doc 4 §4.1 for the internal-call security contract.
 *
 * auth-service is the SYSTEM OF RECORD for user_branch_roles and permission computation.
 * user-service delegates all role writes + permission reads here — it never writes user_branch_roles.
 */
@RestController
@RequestMapping("/internal/auth")
public class AuthInternalController {

    private final BranchRoleAdminService branchRoleAdminService;
    private final PermissionResolver permissionResolver;

    public AuthInternalController(BranchRoleAdminService branchRoleAdminService,
                                  PermissionResolver permissionResolver) {
        this.branchRoleAdminService = branchRoleAdminService;
        this.permissionResolver = permissionResolver;
    }

    /**
     * Assign (upsert) a branch-role for a user. Called by user-service UserAdminService.
     * Requires X-Tenant-Id header identifying the owning tenant.
     */
    @PostMapping("/users/{userId}/branch-roles")
    public ResponseEntity<UserBranchRoleEntity> assignBranchRole(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @Valid @RequestBody BranchRoleAssignRequest request) {
        UserBranchRoleEntity assignment = branchRoleAdminService.assign(tenantId, userId, request);
        return ResponseEntity.ok(assignment);
    }

    /**
     * Revoke (soft-deactivate) a branch-role for a user.
     */
    @DeleteMapping("/users/{userId}/branch-roles")
    public ResponseEntity<Void> revokeBranchRole(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam UUID branchId,
            @RequestParam String roleCode) {
        branchRoleAdminService.revoke(tenantId, userId, branchId, roleCode);
        return ResponseEntity.noContent().build();
    }

    /**
     * Compute permissions for a user at a specific branch (or default branch when branchId omitted).
     * Wraps the existing PermissionResolver — authoritative source for JWT issuance.
     */
    @GetMapping("/users/{userId}/permissions")
    public ResponseEntity<ResolvedBranchAuth> getUserPermissions(
            @PathVariable UUID userId,
            @RequestParam(required = false) UUID branchId) {
        ResolvedBranchAuth resolved = branchId != null
            ? permissionResolver.resolve(userId, branchId)
            : permissionResolver.resolveDefault(userId);
        return ResponseEntity.ok(resolved);
    }
}
