package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.RoleWriteRequest;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.RoleEntry;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.service.RoleAdminService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The write half of the role catalogue (S3) — create, edit and retire a tenant's own role.
 *
 * <p>Sits alongside {@link RoleCatalogController}, which owns the two reads, on the same
 * {@code /api/v1/roles} path already routed to this service by the gateway. Separate class, same
 * resource: the reads answer to the USER-administration code because a screen listing users has to
 * render the role each one holds, and these do NOT — see the gate below.
 *
 * <h2>Why the gate is the role code and not the user code</h2>
 *
 * <p>{@code rbac.role.manage} is 13-02's role-granting authority. Composing a role IS granting
 * authority — it decides what everyone who ever holds it may do — so it belongs behind the same
 * code as assigning one, and deliberately not behind {@code rbac.user.manage}: gating it on the
 * user code would mean anyone able to edit a user's name could also mint the role they are about to
 * be given. {@code rbac.manage} is kept as the accepted alternative on every gate in this phase so
 * OWNER's existing authority is unchanged.
 *
 * <p>Both codes are dotted and both exist in the catalogue, which
 * {@code PermissionCatalogClosureTest} enforces by scanning these expressions — a gate naming a
 * code no role can hold produces a clean, confident 403 for every user including OWNER, and that is
 * the highest-recurrence defect in this codebase.
 *
 * <h2>The gate is not the control</h2>
 *
 * <p>Holding {@code rbac.role.manage} gets a caller through the door and no further. What they may
 * put IN a role is bounded by {@link RoleAdminService}'s ceiling, recomputed from the database
 * against the acting user — which is why the acting user id is taken from the verified token here
 * and never from the request body.
 */
@RestController
@RequestMapping("/api/v1/roles")
public class RoleAdminController {

    /**
     * Written as a compile-time constant so the three verbs cannot drift apart, and so the
     * permission-catalogue closure test still sees the quoted codes when it scans this file.
     */
    private static final String ROLE_ADMIN_GATE =
        "hasAnyAuthority('rbac.manage', 'rbac.role.manage')";

    private final RoleAdminService roleAdminService;

    public RoleAdminController(RoleAdminService roleAdminService) {
        this.roleAdminService = roleAdminService;
    }

    /** Compose a new role for this tenant. 201 with the role as it was written. */
    @PreAuthorize(ROLE_ADMIN_GATE)
    @PostMapping
    public ResponseEntity<ApiResponse<RoleEntry>> create(@Valid @RequestBody RoleWriteRequest request) {
        JwtClaims claims = currentClaims();
        RoleEntry created =
            roleAdminService.create(claims.tenantId(), claims.subject(), request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(created));
    }

    /**
     * Replace what a role is called and what it grants.
     *
     * <p>The permission set in the body is the whole truth about the role afterwards, not a delta.
     * See {@link RoleWriteRequest} for why a checkbox list must not be sent as add/remove pairs.
     */
    @PreAuthorize(ROLE_ADMIN_GATE)
    @PutMapping("/{roleCode}")
    public ResponseEntity<ApiResponse<RoleEntry>> update(@PathVariable String roleCode,
                                                         @Valid @RequestBody RoleWriteRequest request) {
        JwtClaims claims = currentClaims();
        RoleEntry updated =
            roleAdminService.update(claims.tenantId(), claims.subject(), roleCode, request);
        return ResponseEntity.ok(ApiResponse.ok(updated));
    }

    /**
     * Retire a role nobody holds. 409 {@code ROLE_IN_USE} while anybody still does — see
     * {@link RoleAdminService#delete}.
     */
    @PreAuthorize(ROLE_ADMIN_GATE)
    @DeleteMapping("/{roleCode}")
    public ResponseEntity<Void> delete(@PathVariable String roleCode) {
        JwtClaims claims = currentClaims();
        roleAdminService.delete(claims.tenantId(), claims.subject(), roleCode);
        return ResponseEntity.noContent().build();
    }

    /**
     * The caller's claims.
     *
     * <p>Unreachable in practice — {@code @PreAuthorize} has already required an authority no
     * anonymous request can carry — but it throws rather than degrading to a null tenant and a null
     * acting user. That degradation would be the worst possible one here: a null acting user
     * resolves to the EMPTY permission set, which the ceiling reads as "may grant nothing" and
     * would refuse, but a null tenant id would first write a role row with no owner. Failing is the
     * honest answer.
     */
    private JwtClaims currentClaims() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof JwtClaims claims)) {
            throw new AuthenticationFailedException("Not authenticated");
        }
        return claims;
    }
}
