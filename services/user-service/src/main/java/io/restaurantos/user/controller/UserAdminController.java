package io.restaurantos.user.controller;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.service.UserAdminService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Tenant Admin per-branch role assignment surface.
 * All role writes DELEGATE to auth-service (system of record for user_branch_roles).
 * user-service NEVER writes user_branch_roles directly.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserAdminController {

    private final UserAdminService userAdminService;

    public UserAdminController(UserAdminService userAdminService) {
        this.userAdminService = userAdminService;
    }

    /** Assign a branch-role to a user — delegates to auth-service. */
    @PostMapping("/{userId}/branch-roles")
    public ResponseEntity<ApiResponse<Map<String, Object>>> assignBranchRole(
            @PathVariable UUID userId,
            @Valid @RequestBody BranchDtos.BranchRoleRequest request) {
        Map<String, Object> result = userAdminService.assignRole(userId, request);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /** Revoke a branch-role from a user — delegates to auth-service. */
    @DeleteMapping("/{userId}/branch-roles")
    public ResponseEntity<Void> revokeBranchRole(
            @PathVariable UUID userId,
            @RequestParam UUID branchId,
            @RequestParam String roleCode) {
        userAdminService.revokeRole(userId, branchId, roleCode);
        return ResponseEntity.noContent().build();
    }

    /** Read-through: user permissions from auth-service (JWT-issuance concern). */
    @GetMapping("/{userId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getUserPermissions(
            @PathVariable UUID userId,
            @RequestParam(required = false) UUID branchId) {
        Map<String, Object> permissions = userAdminService.getUserPermissions(userId, branchId);
        return ResponseEntity.ok(ApiResponse.ok(permissions));
    }
}
