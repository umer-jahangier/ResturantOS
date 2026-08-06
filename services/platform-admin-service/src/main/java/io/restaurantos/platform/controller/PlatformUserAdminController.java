package io.restaurantos.platform.controller;

import io.restaurantos.platform.client.AuthInternalClient.AdminResetData;
import io.restaurantos.platform.service.PlatformUserAdminService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Platform-tier administration of a tenant's USERS (13-13, D-16).
 *
 * <pre>
 *   POST /api/v1/platform/tenants/{tenantId}/users/{userId}/reset-password
 *        {"reason":"…"}  →  200 {"data":{"userId","email","tempPassword","mustChangePassword"}}
 * </pre>
 *
 * <p><b>A separate class from {@link PlatformAdminController}, deliberately.</b> That class carries
 * tenant lifecycle, subscription and impersonation, and 13-14 edits it; a shared file would have
 * serialised two plans in one wave for no reason other than where a method happened to live. It is
 * also the better boundary on its own merits: administering a tenant's people is a different
 * concern from administering the tenant, with a different blast radius.
 *
 * <p>It carries the SAME class-level {@code SUPER_ADMIN} gate, spelled out here rather than
 * inherited, because an authorization annotation that arrives by inheritance is one a reader of
 * this file cannot see.
 *
 * <h2>The acting administrator</h2>
 *
 * <p>Read from the verified platform principal — the {@code sub} of the RS256-signed control-plane
 * token that {@code JwtAuthenticationFilter} checked against JWKS, which 13-01 made the
 * {@code platform_users.id} and 13-05 made obtainable by a real password login. <b>Never from the
 * body and never from a header.</b> With no resolvable platform principal the operation is REFUSED
 * rather than defaulted: any placeholder produces an audit row naming somebody who did not do it,
 * which is worse than no row at all. That is the same rule, for the same reason, that 13-14 applied
 * to impersonation after the audit found every impersonation row recording its target as its own
 * actor (D-34).
 *
 * <h2>Why a tenant token cannot reach this</h2>
 *
 * <p>Three independent things, and the endpoint relies on all three rather than on the strongest:
 * the gateway admits a token to {@code /api/v1/platform/**} on its own terms; the filter chain
 * requires an authenticated principal; and the {@code SUPER_ADMIN} authority — which a platform
 * token carries as a PERMISSION, deliberately, because 13-01 found authorities are built from the
 * {@code permissions} claim alone — is held by no tenant role.
 */
@RestController
@RequestMapping("/api/v1/platform/tenants")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformUserAdminController {

    private final PlatformUserAdminService platformUserAdminService;

    public PlatformUserAdminController(PlatformUserAdminService platformUserAdminService) {
        this.platformUserAdminService = platformUserAdminService;
    }

    /**
     * Reset a tenant user's password and return the temporary one ONCE.
     *
     * <p>This is the escape hatch for a tenant that has locked itself out of its own highest role,
     * which nobody inside that tenant can fix: the role ceiling correctly refuses a lesser role
     * resetting a greater one. See {@link PlatformUserAdminService} for what the capability costs
     * and what compensates for it (T-13-13-F, accepted).
     *
     * <p><b>No idempotency key, deliberately.</b> {@code POST /api/v1/platform/tenants} takes one
     * and stores its response in {@code platform_db.idempotency_keys.response_json} — a plain text
     * column nothing ever purges (13-10). A credential written there is permanent, so this endpoint
     * does not take a key and its response is never captured by one. A repeated reset is harmless
     * and honest: it mints a new temporary password and audits a second row, which is what actually
     * happened.
     *
     * <p>The response's {@code tempPassword} must be delivered out of band and must not be logged.
     * There is no email path in this milestone (13-09, D-31) — the SuperAdmin IS the delivery
     * channel.
     */
    @PostMapping("/{tenantId}/users/{userId}/reset-password")
    public ResponseEntity<ApiResponse<AdminResetData>> resetUserPassword(
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody PlatformResetRequest request) {
        UUID actingPlatformUserId = requirePlatformPrincipal();
        return ResponseEntity.ok(ApiResponse.ok(platformUserAdminService.reset(
            tenantId, userId, actingPlatformUserId, request.reason())));
    }

    /**
     * The reason, and nothing else.
     *
     * <p>{@code @NotBlank} because every reset is audited and a row that cannot say why is one
     * somebody has to interpret rather than read (T-13-13-E). There is no acting-administrator
     * field: see the class comment.
     */
    public record PlatformResetRequest(@NotBlank @Size(max = 500) String reason) {}

    /**
     * The authenticated platform user's id, or a refusal.
     *
     * <p>Duplicated from {@link PlatformAdminController} rather than shared, and that is a
     * deliberate three lines: extracting it would mean editing that file, which 13-14 owned in the
     * same wave, and the alternative — a helper class for one {@code SecurityContextHolder} read —
     * hides a security-relevant lookup behind an indirection. If a third caller appears it should
     * be extracted then.
     */
    private UUID requirePlatformPrincipal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Object principal = authentication != null ? authentication.getPrincipal() : null;
        if (principal instanceof JwtClaims claims && claims.subject() != null) {
            return claims.subject();
        }
        throw new PermissionDeniedException(
            "A password reset requires an authenticated platform administrator; the acting id is "
                + "taken from the verified token and is never substituted");
    }
}
