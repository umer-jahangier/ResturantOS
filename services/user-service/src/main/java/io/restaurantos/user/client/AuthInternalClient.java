package io.restaurantos.user.client;

import io.restaurantos.user.dto.BranchDtos;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * Feign client delegating branch-role writes + permission reads to auth-service /internal/auth/**.
 * auth-service is the SYSTEM OF RECORD for user_branch_roles — user-service never writes that table.
 * The X-Internal-Service secret is injected by FeignInternalConfig on every call (Doc 4 §4.1).
 */
@FeignClient(
    name = "auth-service",
    url = "${restaurantos.auth-service.uri}",
    configuration = io.restaurantos.user.client.FeignInternalConfig.class
)
public interface AuthInternalClient {

    /**
     * Assign (upsert) a branch-role for a user in auth-service (system of record).
     * Corresponds to POST /internal/auth/users/{userId}/branch-roles.
     */
    @PostMapping("/internal/auth/users/{userId}/branch-roles")
    Map<String, Object> assignBranchRole(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestBody BranchDtos.BranchRoleRequest request
    );

    /**
     * Revoke (soft-deactivate) a branch-role for a user.
     * Corresponds to DELETE /internal/auth/users/{userId}/branch-roles.
     */
    @DeleteMapping("/internal/auth/users/{userId}/branch-roles")
    void revokeBranchRole(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestParam("branchId") UUID branchId,
        @RequestParam("roleCode") String roleCode
    );

    /**
     * Compute permissions for a user at a branch (optional branchId).
     * Corresponds to GET /internal/auth/users/{userId}/permissions.
     */
    @GetMapping("/internal/auth/users/{userId}/permissions")
    Map<String, Object> getUserPermissions(
        @PathVariable("userId") UUID userId,
        @RequestParam(value = "branchId", required = false) UUID branchId
    );
}
