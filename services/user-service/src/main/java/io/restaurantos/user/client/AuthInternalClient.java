package io.restaurantos.user.client;

import io.restaurantos.user.dto.BranchDtos;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

import java.util.List;
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
     *
     * <p><b>{@code X-Acting-User-Id} is REQUIRED (13-11).</b> auth-service bounds what this request
     * may grant by the ACTING user's own permissions — the assigner may only grant a role whose
     * permission set is a subset of their own. Before that seam existed, {@code /internal/auth/**}
     * carried no identity, auth-service could not answer "may THIS person grant THAT role", and a
     * TENANT_ADMIN assigning OWNER was answered 200.
     *
     * <p>The value must come from the VERIFIED JWT — {@code TenantContext.getUserId()}, populated
     * by {@code JwtAuthenticationFilter} from the token's subject — and never from a request body
     * or a client-supplied header. The gateway's {@code StripInternalHeaderFilter} deletes this
     * header from every inbound request for exactly that reason.
     */
    @PostMapping("/internal/auth/users/{userId}/branch-roles")
    Map<String, Object> assignBranchRole(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestHeader("X-Acting-User-Id") UUID actingUserId,
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
     * List active branch-role assignments for a user (auth-service system of record).
     */
    @GetMapping("/internal/auth/users/{userId}/branch-roles")
    List<BranchDtos.BranchRoleAssignment> listBranchRoles(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId
    );

    /**
     * Compute permissions for a user at a branch (optional branchId).
     * Corresponds to GET /internal/auth/users/{userId}/permissions.
     *
     * <p>X-Tenant-Id is required in practice even though auth-service accepts its absence: it is
     * what puts the RLS GUC on auth-service's connection. Omitting it made every read match zero
     * rows and answer "user has no active branch assignments" for a user who had them.
     */
    @GetMapping("/internal/auth/users/{userId}/permissions")
    Map<String, Object> getUserPermissions(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestParam(value = "branchId", required = false) UUID branchId
    );
}
