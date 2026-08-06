package io.restaurantos.user.client;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.dto.UserAdminDtos;
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

    // ── The user lifecycle (13-11's six endpoints) ───────────────────────────────────────────
    //
    // Typed, not Map-shaped. STATE.md records a Phase 7-to-10 integration repair that existed
    // because untyped payloads produced four dead seams — a field renamed on the producer side is
    // a null on the consumer side and nothing anywhere fails — and 13-10's provisioning saga fixed
    // a fifth of the same shape (extractBranchId parsed {"data":{"id"}} against a producer that
    // returned {branchId}, so it silently substituted a random UUID). These records are separate
    // from auth-service's UserDtos on purpose; see UserAdminDtos.
    //
    // X-Acting-User-Id is REQUIRED on every write below and on none of the reads. See
    // assignBranchRole above for why it is an identity and never an entitlement.

    /** One page of this tenant's users. Sort is fixed at (email, id) upstream; size is capped at 200. */
    @GetMapping("/internal/auth/users")
    ApiResponse<List<UserAdminDtos.UserSummary>> listUsers(
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestParam("page") int page,
        @RequestParam("size") int size,
        @RequestParam("activeOnly") boolean activeOnly,
        @RequestParam("search") String search
    );

    /** One user of this tenant. Another tenant's id answers 404 upstream — never 403. */
    @GetMapping("/internal/auth/users/{userId}")
    ApiResponse<UserAdminDtos.UserDetail> getUser(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId
    );

    /** Create a user; the response carries the one-time temporary password. */
    @PostMapping("/internal/auth/users")
    ApiResponse<UserAdminDtos.CreatedUser> createUser(
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestHeader("X-Acting-User-Id") UUID actingUserId,
        @RequestBody UserAdminDtos.CreateUserRequest request
    );

    /**
     * Patch name / locale / active.
     *
     * <p>The wire shape is declared here rather than reusing the public
     * {@link UserAdminDtos.UpdateUserRequest}: that type exists to <em>reject</em> a password field
     * a client sent, and serialising it outbound would put its {@code @JsonAnySetter} plumbing on
     * the wire. This record names exactly the three fields the internal contract accepts, so a
     * fourth cannot be forwarded by accident.
     */
    @PatchMapping("/internal/auth/users/{userId}")
    ApiResponse<UserAdminDtos.UserDetail> updateUser(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestHeader("X-Acting-User-Id") UUID actingUserId,
        @RequestBody InternalUpdateUser request
    );

    /** Flag off + refresh sessions revoked. Never deletes; the row and its assignments survive. */
    @PostMapping("/internal/auth/users/{userId}/deactivate")
    ApiResponse<UserAdminDtos.UserDetail> deactivateUser(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestHeader("X-Acting-User-Id") UUID actingUserId
    );

    /** Flag on. Sessions are deliberately NOT restored upstream. */
    @PostMapping("/internal/auth/users/{userId}/reactivate")
    ApiResponse<UserAdminDtos.UserDetail> reactivateUser(
        @PathVariable("userId") UUID userId,
        @RequestHeader("X-Tenant-Id") UUID tenantId,
        @RequestHeader("X-Acting-User-Id") UUID actingUserId
    );

    /** The three fields PATCH /internal/auth/users/{userId} accepts, and no others. */
    record InternalUpdateUser(String fullName, String locale, Boolean active) {}
}
