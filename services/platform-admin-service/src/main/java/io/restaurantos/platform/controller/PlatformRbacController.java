package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformUserDtos.PlatformPermissionModule;
import io.restaurantos.platform.dto.PlatformUserDtos.RoleCatalogResponse;
import io.restaurantos.platform.dto.PlatformUserDtos.RolePermissionMatrix;
import io.restaurantos.platform.service.PlatformRbacService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The platform tier's view of the authorization model (superadmin plan).
 *
 * <pre>
 *   GET /api/v1/platform/rbac/permissions            the whole vocabulary, grouped by module
 *   GET /api/v1/platform/rbac/roles[?tenantId=]      roles, their grants and their holder counts
 *   GET /api/v1/platform/rbac/matrix[?tenantId=]     the role x permission grid
 * </pre>
 *
 * <h2>Three reads and no writes — a decision, recorded in the response itself</h2>
 *
 * <p>Composing a role IS granting authority. At the tenant tier that is bounded by the role ceiling:
 * an assigner may only grant a role whose permissions are a subset of their own, recomputed from
 * the database on every call. A platform operator holds no {@code user_branch_roles}, so the
 * ceiling resolves the empty set against them — there is nothing to bound a platform-tier role
 * editor with.
 *
 * <p>13-02 split {@code rbac.manage} out of {@code rbac.role.manage} precisely so a TENANT_ADMIN
 * could not compose themselves an OWNER, log in as it, and hold the umbrella permission their own
 * role was designed to withhold. <b>This module does not hand that back one layer up.</b> The reason
 * travels in every response as {@code readOnlyReason}, so a console developer reading the payload
 * learns why there is nothing to call instead of filing it as a missing endpoint — and so a future
 * plan that wants to add one has to delete a sentence that explains why not.
 *
 * <p>Tenant custom roles stay editable by that tenant's own administrators through
 * {@code POST/PUT/DELETE /api/v1/roles}, which keeps its ceiling. System roles are seeded by
 * Liquibase and are editable by nobody at any tier.
 *
 * <h2>Why this is not the public catalogue endpoint</h2>
 *
 * <p>{@code GET /api/v1/roles} is gated {@code hasAnyAuthority('rbac.manage','rbac.user.manage')}
 * and scopes itself from the token's {@code tenant_id} claim. A platform token carries
 * {@code permissions=[SUPER_ADMIN]} and no tenant claim at all, so it fails the gate and would have
 * no tenant to scope to if the gate were widened. The platform tier therefore reads through an
 * internal endpoint that takes the tenant as a parameter and sets the row-level-security GUC from
 * it — see {@code RbacCatalogInternalService} in auth-service.
 *
 * <p>The catalogue enumerates the platform's entire authorization surface and is a reconnaissance
 * document (T-13-07-A), which is why it sits behind {@code SUPER_ADMIN} here and behind a
 * constant-time shared secret on an unrouted path there.
 */
@RestController
@RequestMapping("/api/v1/platform/rbac")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformRbacController {

    private final PlatformRbacService rbacService;

    public PlatformRbacController(PlatformRbacService rbacService) {
        this.rbacService = rbacService;
    }

    /**
     * The permission vocabulary, grouped by module.
     *
     * <p>Takes no tenant and must not grow one: {@code permissions} is global, non-RLS and identical
     * for every tenant.
     *
     * <p>The count is whatever the database declares. It is deliberately not asserted against a
     * constant anywhere in this service — a hardcoded total would be right on the day it was written
     * and wrong after the next changeset, which is the drift class this repository has repeatedly
     * hit over permission codes.
     */
    @GetMapping("/permissions")
    public ResponseEntity<ApiResponse<List<PlatformPermissionModule>>> permissions() {
        return ResponseEntity.ok(ApiResponse.ok(rbacService.permissions()));
    }

    /**
     * The role catalogue.
     *
     * <p>{@code tenantId} omitted means the GLOBAL catalogue — the system roles only, which is what
     * every tenant inherits. Named, it adds that tenant's own custom roles and populates
     * {@code assignedUserCount}, which is a per-tenant fact and is 0 in the global view because a
     * fleet-wide sum is a number nobody asked for.
     *
     * <p>An unknown {@code tenantId} is 404. Without that check a typo'd id would return the
     * system-role catalogue with a 200 — an answer that looks right, IS right for some tenant, and
     * is not the one asked about.
     */
    @GetMapping("/roles")
    public ResponseEntity<ApiResponse<RoleCatalogResponse>> roles(
            @RequestParam(required = false) UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(rbacService.roles(tenantId)));
    }

    /**
     * The role x permission matrix, in the shape a grid renders.
     *
     * <p>The columns are EVERY permission that exists, not only the granted ones, because the
     * question a matrix is usually opened for is "what can nobody do?" — an orphaned permission that
     * no role grants produces a clean 403 for every user including OWNER, which is the
     * highest-recurrence defect in this codebase and which the auth changelog carries repair
     * changesets for.
     *
     * <p>Grants are a set of codes per row rather than a positional boolean array, so adding a
     * permission cannot silently shift every role's grants by one column in a client that cached
     * the header.
     */
    @GetMapping("/matrix")
    public ResponseEntity<ApiResponse<RolePermissionMatrix>> matrix(
            @RequestParam(required = false) UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(rbacService.matrix(tenantId)));
    }
}
