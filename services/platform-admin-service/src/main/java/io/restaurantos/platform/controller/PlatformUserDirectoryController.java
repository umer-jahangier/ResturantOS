package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformUserDtos.PlatformUserPage;
import io.restaurantos.platform.service.PlatformUserDirectoryService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The cross-tenant user directory (superadmin plan) — {@code GET /api/v1/platform/users}.
 *
 * <pre>
 *   GET /api/v1/platform/users?tenantId=&amp;tenantStatus=&amp;status=&amp;roleCode=&amp;search=&amp;page=&amp;size=
 * </pre>
 *
 * <h2>Read this before building a screen on it: the fleet list is N calls, not a query</h2>
 *
 * <p>There is no cross-tenant user query in this product. {@code auth_db.users} is FORCE row-level
 * security on {@code app.current_tenant_id}, {@code platform_db} holds zero grants in
 * {@code auth_db} and has no {@code postgres_fdw} or {@code dblink}, and the only door
 * ({@code GET /internal/auth/users}) requires {@code X-Tenant-Id} and returns ONE tenant's page. So
 * this endpoint fans out one HTTP call per tenant, and the response's {@code scan} block says how
 * many it made, which tenants it could not read, and whether the fan-out cap cut it short.
 *
 * <p><b>Prefer {@code GET /api/v1/platform/tenants/{tenantId}/users}</b> whenever the tenant is
 * known: it is one call. This endpoint exists for the genuine fleet-wide question ("find the user
 * with this email, I do not know their tenant"), and the honest UI for it is a search rather than a
 * grid somebody scrolls.
 *
 * <p>The {@code scan} block is part of the DATA and not a warning header, because a client that has
 * to opt in to noticing an incomplete answer will not. When any tenant is unreachable the total is
 * <b>withheld</b> rather than reported smaller — a number that looks complete and is not is the
 * D-38-16 violation the whole shape exists to refuse.
 *
 * <h2>Why a separate class from {@link PlatformUserAdminController}</h2>
 *
 * <p>That one is mounted under {@code /api/v1/platform/tenants} and is where the MUTATIONS live —
 * every one of them audited, every one of them taking a mandatory reason and a platform principal
 * read from a verified token. This class is read-only and has no principal lookup at all, which is
 * a property a reviewer can check by its length. Same class-level {@code SUPER_ADMIN} gate, spelled
 * out here rather than inherited, because an authorization annotation that arrives by inheritance
 * is one a reader of this file cannot see.
 */
@RestController
@RequestMapping("/api/v1/platform/users")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformUserDirectoryController {

    private final PlatformUserDirectoryService directoryService;

    public PlatformUserDirectoryController(PlatformUserDirectoryService directoryService) {
        this.directoryService = directoryService;
    }

    /**
     * One page of the concatenated per-tenant lists, tenants in slug order.
     *
     * @param tenantId     collapses this to the single-call path. An unknown id is 404, never an
     *                     empty page
     * @param tenantStatus narrows the fan-out to tenants in one lifecycle state — worth using, since
     *                     it skips the per-tenant call for tenants nobody can log into anyway. An
     *                     unrecognised value is 400, not an ignored filter
     * @param status       {@code ACTIVE} | {@code INACTIVE} | {@code LOCKED} on the USER.
     *                     {@code ACTIVE} means usable right now — the flag is on AND no live
     *                     lockout — because an account with a future {@code locked_until} cannot log
     *                     in, and listing it as active tells an operator the opposite of what they
     *                     need
     * @param roleCode     an ACTIVE branch-role code the user holds at any branch. Not validated
     *                     against the catalogue on purpose: an unknown code legitimately matches
     *                     nobody, and refusing it would make the directory unable to answer "does
     *                     anyone still hold this retired role?"
     * @param search       matched case-insensitively against email and full name
     */
    @GetMapping
    public ResponseEntity<ApiResponse<PlatformUserPage>> list(
            @RequestParam(required = false) UUID tenantId,
            @RequestParam(required = false) String tenantStatus,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String roleCode,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.ok(directoryService.list(
            tenantId, tenantStatus, status, roleCode, search, page, size)));
    }
}
