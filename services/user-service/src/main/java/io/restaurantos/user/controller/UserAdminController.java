package io.restaurantos.user.controller;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.service.UserAdminService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Tenant Admin per-branch role assignment surface.
 * All role writes DELEGATE to auth-service (system of record for user_branch_roles).
 * user-service NEVER writes user_branch_roles directly.
 *
 * <p><b>Gating.</b> Every method here used to require {@code rbac.manage} alone, which no
 * TENANT_ADMIN holds (changeset 030 grants that role every permission <em>except</em> that one), so
 * only OWNER could administer anything and "multiple admins per tenant" did not work. Phase 13
 * splits the authority: {@code rbac.role.manage} for granting and revoking roles,
 * {@code rbac.user.manage} for reading and administering the user record. {@code rbac.manage} is
 * kept as an accepted alternative on both so OWNER's existing authority is unchanged.
 *
 * <p>The two writes take the <em>role</em> code and the read takes the <em>user</em> code
 * deliberately. Splitting the codes and then gating role assignment on the user-administration
 * code would defeat the split: anyone able to edit a user would be able to grant themselves OWNER.
 * Both codes are currently held by exactly the same two roles, so this changes nothing today — it
 * is what makes a narrower custom role possible later without re-auditing these endpoints.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserAdminController {

    private final UserAdminService userAdminService;

    public UserAdminController(UserAdminService userAdminService) {
        this.userAdminService = userAdminService;
    }

    /** Assign a branch-role to a user — delegates to auth-service. */
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'rbac.role.manage')")
    @PostMapping("/{userId}/branch-roles")
    public ResponseEntity<ApiResponse<Map<String, Object>>> assignBranchRole(
            @PathVariable UUID userId,
            @Valid @RequestBody BranchDtos.BranchRoleRequest request) {
        Map<String, Object> result = userAdminService.assignRole(userId, request);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /** Revoke a branch-role from a user — delegates to auth-service. */
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'rbac.role.manage')")
    @DeleteMapping("/{userId}/branch-roles")
    public ResponseEntity<Void> revokeBranchRole(
            @PathVariable UUID userId,
            @RequestParam UUID branchId,
            @RequestParam String roleCode) {
        userAdminService.revokeRole(userId, branchId, roleCode);
        return ResponseEntity.noContent().build();
    }

    /** Read-through: user permissions from auth-service (JWT-issuance concern). */
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'rbac.user.manage')")
    @GetMapping("/{userId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getUserPermissions(
            @PathVariable UUID userId,
            @RequestParam(required = false) UUID branchId) {
        Map<String, Object> permissions = userAdminService.getUserPermissions(userId, branchId);
        return ResponseEntity.ok(ApiResponse.ok(permissions));
    }
}
