package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.response.RoleCatalogDtos.PermissionModule;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.RoleEntry;
import io.restaurantos.auth.service.RbacCatalogInternalService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The RBAC catalogue on the internal seam, for the platform control plane (superadmin plan).
 *
 * <pre>
 *   GET /internal/auth/rbac/permissions              the whole vocabulary, grouped by module
 *   GET /internal/auth/rbac/roles[?tenantId=…]       roles + their permission codes + holder counts
 * </pre>
 *
 * <p><b>Two reads and no writes, and the absence is the design.</b> See
 * {@link RbacCatalogInternalService} for why a platform-tier role editor is a deliberate omission
 * rather than a missing feature.
 *
 * <p>Gated by {@code InternalServiceFilter}'s constant-time shared secret; the gateway maps no route
 * to {@code /internal/**}, so this catalogue — which enumerates the platform's entire authorization
 * surface and is therefore a reconnaissance document (T-13-07-A) — is unreachable from outside the
 * cluster. The authorization of the HUMAN belongs to the calling tier: platform-admin-service's
 * class-level {@code hasAuthority('SUPER_ADMIN')}.
 *
 * <p>A separate class from {@link RoleCatalogController} even though both read the same three
 * tables: that one is JWT-authorized, tenant-scoped from claims and ceiling-filtered, this one is
 * secret-authorized, tenant-scoped from a parameter and unfiltered. One class with a mode flag
 * would put "is the ceiling applied?" behind a boolean, which is the shape of every authorization
 * defect this phase has found.
 */
@RestController
@RequestMapping("/internal/auth/rbac")
public class RbacCatalogInternalController {

    private final RbacCatalogInternalService rbacCatalogInternalService;

    public RbacCatalogInternalController(RbacCatalogInternalService rbacCatalogInternalService) {
        this.rbacCatalogInternalService = rbacCatalogInternalService;
    }

    /**
     * The permission vocabulary. Global and identical for every tenant, so it takes no tenant and
     * must not grow one — {@code permissions} is the one non-RLS table of the three (changeset 030)
     * and a tenant parameter here would imply a scoping that does not exist.
     */
    @GetMapping("/permissions")
    public ResponseEntity<ApiResponse<List<PermissionModule>>> permissions() {
        return ResponseEntity.ok(ApiResponse.ok(rbacCatalogInternalService.permissions()));
    }

    /**
     * Every role visible to a tenant: the nine system roles, plus that tenant's own custom roles
     * if it has any (changeset 092 made those legal and RLS-scoped).
     *
     * <p>{@code tenantId} is OPTIONAL and omitting it is meaningful rather than sloppy: absent means
     * "the global catalogue", and yields the system roles only. It is not defaulted to some tenant,
     * and it fails closed — see {@code RoleRepository.findVisibleToTenant}.
     */
    @GetMapping("/roles")
    public ResponseEntity<ApiResponse<List<RoleEntry>>> roles(
            @RequestParam(required = false) UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(rbacCatalogInternalService.roles(tenantId)));
    }
}
