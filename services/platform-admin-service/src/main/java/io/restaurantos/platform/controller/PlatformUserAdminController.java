package io.restaurantos.platform.controller;

import io.restaurantos.platform.client.AuthInternalClient.AdminResetData;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserDetailData;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserSecurityData;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformActionRequest;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformUserDetail;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformUserPage;
import io.restaurantos.platform.service.PlatformUserAdminService;
import io.restaurantos.platform.service.PlatformUserDirectoryService;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
    private final PlatformUserDirectoryService directoryService;

    public PlatformUserAdminController(PlatformUserAdminService platformUserAdminService,
                                       PlatformUserDirectoryService directoryService) {
        this.platformUserAdminService = platformUserAdminService;
        this.directoryService = directoryService;
    }

    // ── Reads ────────────────────────────────────────────────────────────────────────────────

    /**
     * {@code GET /api/v1/platform/tenants/{tenantId}/users?status=&roleCode=&search=&page=&size=}
     *
     * <p>One tenant's users — the CHEAP path, and the one a console should prefer. It is a single
     * upstream call, unlike {@code GET /api/v1/platform/users}, which fans out one call per tenant
     * because there is no cross-tenant user query anywhere in this product.
     *
     * <p>Every filter is pushed to auth-service's own query rather than applied here: a page
     * filtered after the fact carries a {@code totalCount} describing a different set from its own
     * rows, and the role filter would otherwise be an N+1 across a service boundary.
     *
     * <p>An unknown {@code tenantId} is <b>404</b>, not an empty page. On this screen those two
     * answers mean opposite things and must not look the same.
     *
     * <p>{@code status} is {@code ACTIVE} | {@code INACTIVE} | {@code LOCKED} and an unrecognised
     * value is refused upstream rather than ignored — a caller who asked for the locked accounts
     * and received all of them would have no way to notice.
     */
    @GetMapping("/{tenantId}/users")
    public ResponseEntity<ApiResponse<PlatformUserPage>> listTenantUsers(
            @PathVariable UUID tenantId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String roleCode,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.ok(directoryService.list(
            tenantId, null, status, roleCode, search, page, size)));
    }

    /**
     * {@code GET /api/v1/platform/tenants/{tenantId}/users/{userId}}
     *
     * <p>Profile, tenant membership, branch-role assignments, station scopes, and the one activity
     * signal this platform actually records.
     *
     * <p>Three things in the response are shaped to be honest rather than tidy, and a client must
     * not collapse them:
     * <ul>
     *   <li>{@code activity.lastLoginAt} null means <b>never signed in</b> — a real state, and the
     *       shape of a provisioned-but-unusable account. Attempt-level login history exists in
     *       {@code audit_db} and the platform plane cannot read it;</li>
     *   <li>{@code stationScopes} null means <b>we could not find out</b>, while an empty list means
     *       <b>unrestricted</b> — a user with no station rows sees every station at their branch;</li>
     *   <li>{@code loginable} is computed, with {@code loginableNote} saying why when it is false.
     *       An account with no active assignment looks created and cannot be used, which is exactly
     *       the failure blocker B2 was.</li>
     * </ul>
     */
    @GetMapping("/{tenantId}/users/{userId}")
    public ResponseEntity<ApiResponse<PlatformUserDetail>> getTenantUser(
            @PathVariable UUID tenantId,
            @PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(directoryService.detail(tenantId, userId)));
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

    // ── Lifecycle mutations ──────────────────────────────────────────────────────────────────
    //
    // Four operations sharing one shape, one gate and one audited path. Each takes a MANDATORY
    // reason and nothing else: there is no acting-administrator field on any of them, because a
    // body field naming the actor is a field a caller can fill in with somebody else's name
    // (T-13-13-G). The acting id is the sub of the verified control-plane token, always.
    //
    // NONE of them can grant anything. There is deliberately no role-assignment endpoint on this
    // controller and none should be added — 13-02 split rbac.manage so a tenant admin could not
    // mint an OWNER, and a platform tier with no ceiling doing it from above would be that
    // escalation with a wider blast radius. The platform view of roles is read-only; see
    // PlatformRbacController.
    //
    // No idempotency key on any of them, for the reason the reset records: this service stores
    // idempotent responses in a plain-text column nothing purges. A repeated deactivate is
    // harmless and honest — it writes a second audit row, which is what actually happened.

    /**
     * {@code POST /api/v1/platform/tenants/{tenantId}/users/{userId}/deactivate  {"reason":"…"}}
     *
     * <p>The durable lock: flag off, every live refresh session revoked, row and assignments
     * untouched. Never deletes, so audit rows and orders referencing the user id stay resolvable.
     *
     * <p><b>Already-issued ACCESS tokens survive until they expire</b> — they are stateless and
     * there is no revocation list. A console must not render this as "access removed"; the residual
     * window is the access-token TTL.
     */
    @PostMapping("/{tenantId}/users/{userId}/deactivate")
    public ResponseEntity<ApiResponse<UserDetailData>> deactivateUser(
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody PlatformActionRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(platformUserAdminService.deactivate(
            tenantId, userId, requirePlatformPrincipal(), request.reason())));
    }

    /**
     * {@code POST /api/v1/platform/tenants/{tenantId}/users/{userId}/reactivate  {"reason":"…"}}
     *
     * <p>Flag on. <b>Sessions are deliberately not restored</b>: revocation is not reversible and
     * should not be, because the sessions revoked at deactivation may have been on a device the
     * person no longer has. The user logs in again, which is the point at which the platform
     * re-establishes who is holding the account.
     */
    @PostMapping("/{tenantId}/users/{userId}/reactivate")
    public ResponseEntity<ApiResponse<UserDetailData>> reactivateUser(
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody PlatformActionRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(platformUserAdminService.reactivate(
            tenantId, userId, requirePlatformPrincipal(), request.reason())));
    }

    /**
     * {@code POST /api/v1/platform/tenants/{tenantId}/users/{userId}/unlock  {"reason":"…"}}
     *
     * <p>Clears the brute-force lockout counter and timestamp. <b>Not the same operation as
     * reactivating</b>, and they are separate endpoints so an operator cannot confuse them:
     * {@code locked_until} is a fifteen-minute cooldown that expires by itself, {@code is_active}
     * is the durable lock.
     *
     * <p>{@code lockedUntil: null} in the response means "not locked" — a state, not a blank date.
     */
    @PostMapping("/{tenantId}/users/{userId}/unlock")
    public ResponseEntity<ApiResponse<UserSecurityData>> unlockUser(
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody PlatformActionRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(platformUserAdminService.unlock(
            tenantId, userId, requirePlatformPrincipal(), request.reason())));
    }

    /**
     * {@code POST /api/v1/platform/tenants/{tenantId}/users/{userId}/revoke-sessions
     * {"reason":"…"}}
     *
     * <p>Sign the user out everywhere, account untouched. {@code sessionsRevoked} counts REFRESH
     * sessions; already-issued access tokens survive until they expire, and there is no revocation
     * list to change that.
     *
     * <p>{@code sessionsRevoked: 0} means the user held no live session — a measured zero, not a
     * failed call. It is returned rather than answering 204 for exactly that reason.
     */
    @PostMapping("/{tenantId}/users/{userId}/revoke-sessions")
    public ResponseEntity<ApiResponse<UserSecurityData>> revokeUserSessions(
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody PlatformActionRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(platformUserAdminService.revokeSessions(
            tenantId, userId, requirePlatformPrincipal(), request.reason())));
    }

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
            "A platform-tier action on a tenant user requires an authenticated platform "
                + "administrator; the acting id is taken from the verified token and is never "
                + "substituted");
    }
}
