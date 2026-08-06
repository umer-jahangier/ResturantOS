package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.response.RoleCatalogDtos.AssignableRoles;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.PermissionModule;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.RoleEntry;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.service.RoleCatalogService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The role and permission catalog (D-14) — what a role picker needs before it can exist.
 *
 * <p>Two authenticated reads:
 * <ul>
 *   <li>{@code GET /api/v1/roles} — the roles this caller may assign, each with its permission
 *       codes.</li>
 *   <li>{@code GET /api/v1/permissions} — the platform's permission vocabulary, grouped by
 *       module.</li>
 * </ul>
 *
 * <h2>Why these are not public</h2>
 *
 * <p>The permission catalog enumerates the entire authorization surface of the platform: every gate
 * that exists, and by implication every feature behind one. That is a reconnaissance document, and
 * it costs nothing to keep behind the same authority that administers users (T-13-07-A). Neither
 * path is in the gateway's {@code PUBLIC_PATHS}, and both are asserted live to answer 401 without a
 * token and 403 for a logged-in caller holding neither administration code.
 *
 * <h2>Why the gate names these two codes</h2>
 *
 * <p>{@code rbac.user.manage} is 13-02's user-administration code, held by OWNER and TENANT_ADMIN.
 * {@code rbac.manage} is the umbrella code, kept as an accepted alternative on every gate this
 * phase re-gated so OWNER's existing authority is unchanged. The read takes the USER code rather
 * than {@code rbac.role.manage} deliberately: a caller who may list and edit users but not grant
 * roles still has to render the role a user holds, and refusing them the catalog would leave that
 * screen showing a bare code.
 *
 * <p>Both codes are dotted, and both exist in the catalog. That is load-bearing:
 * {@code PermissionCatalogClosureTest} scans these expressions and fails on any dotted code the
 * changelog does not declare — a gate naming a code no role can hold produces a clean, confident
 * 403 for every user including OWNER, which is the highest-recurrence defect in this codebase.
 */
@RestController
@RequestMapping("/api/v1")
public class RoleCatalogController {

    /**
     * Written as a compile-time constant so both gates cannot drift apart, and so the closure test
     * still sees the quoted codes when it scans this file.
     */
    private static final String ADMINISTRATION_GATE =
        "hasAnyAuthority('rbac.manage', 'rbac.user.manage')";

    private final RoleCatalogService roleCatalogService;

    public RoleCatalogController(RoleCatalogService roleCatalogService) {
        this.roleCatalogService = roleCatalogService;
    }

    /**
     * The roles this caller may assign — never one above their own ceiling, and never another
     * tenant's.
     *
     * <p>When roles were withheld the response carries a {@code ROLES_WITHHELD_ABOVE_CEILING}
     * warning with the count. A count, never the names: naming them would republish exactly what
     * the ceiling exists to withhold. A count is what turns "why is OWNER missing from my picker"
     * from a support ticket into an answer, and its recipient is already an administrator of this
     * tenant.
     */
    @PreAuthorize(ADMINISTRATION_GATE)
    @GetMapping("/roles")
    public ResponseEntity<ApiResponse<List<RoleEntry>>> listRoles() {
        JwtClaims claims = currentClaims();
        AssignableRoles assignable =
            roleCatalogService.listAssignableRoles(claims.tenantId(), claims.permissions());

        List<ApiResponse.ApiWarning> warnings = assignable.withheldAboveCeiling() == 0
            ? List.of()
            : List.of(new ApiResponse.ApiWarning("ROLES_WITHHELD_ABOVE_CEILING",
                assignable.withheldAboveCeiling() + " role(s) were withheld because they grant "
                    + "permissions you do not hold and therefore cannot assign"));

        return ResponseEntity.ok(new ApiResponse<>(assignable.roles(), null, warnings));
    }

    /** The permission vocabulary, grouped by module. Global; identical for every tenant. */
    @PreAuthorize(ADMINISTRATION_GATE)
    @GetMapping("/permissions")
    public ResponseEntity<ApiResponse<List<PermissionModule>>> listPermissions() {
        return ResponseEntity.ok(ApiResponse.ok(roleCatalogService.listPermissionsByModule()));
    }

    /**
     * The caller's claims.
     *
     * <p>Unreachable in practice — {@code @PreAuthorize} has already required an authority, which
     * no anonymous request can carry — but it must not degrade to "no tenant, no permissions" if it
     * ever does become reachable: that would read every role as above the ceiling AND every tenant
     * role as invisible, i.e. an empty catalog rather than an error. Failing is the honest answer.
     */
    private JwtClaims currentClaims() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof JwtClaims claims)) {
            throw new AuthenticationFailedException("Not authenticated");
        }
        return claims;
    }
}
