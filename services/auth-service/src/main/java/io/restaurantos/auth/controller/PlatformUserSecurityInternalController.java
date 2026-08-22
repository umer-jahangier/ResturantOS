package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.response.UserDtos.UserDetail;
import io.restaurantos.auth.dto.response.UserDtos.UserSecurityState;
import io.restaurantos.auth.exception.ActingUserRequiredException;
import io.restaurantos.auth.service.AdminPasswordResetService.ActorTier;
import io.restaurantos.auth.service.UserLifecycleService;
import io.restaurantos.shared.api.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The PLATFORM tier's account-security actions on a tenant's user (superadmin plan).
 *
 * <pre>
 *   POST /internal/auth/platform/users/{userId}/deactivate       → 200 UserDetail
 *   POST /internal/auth/platform/users/{userId}/reactivate       → 200 UserDetail
 *   POST /internal/auth/platform/users/{userId}/unlock           → 200 UserSecurityState
 *   POST /internal/auth/platform/users/{userId}/revoke-sessions  → 200 UserSecurityState
 *        headers on all four: X-Internal-Service, X-Tenant-Id, X-Acting-User-Id
 * </pre>
 *
 * <h2>Why the tier is in the PATH and not in the body</h2>
 *
 * <p>{@code AdminPasswordResetInternalController} takes {@code actorTier} as a body field because
 * one routine serves both tiers and the calling service asserts which it is. Here the platform tier
 * is the only tier, so the discriminator is structural: there is no value any caller can send that
 * turns a tenant-tier call into a platform-tier one, and no field that could be defaulted the
 * fail-open way round. That is strictly stronger than a body enum, and it is why these are separate
 * paths from {@link UserLifecycleInternalController}'s {@code /deactivate} and {@code /reactivate}
 * rather than the same ones with a flag.
 *
 * <p>The tenant-tier paths are untouched and keep their role ceiling. Nothing here widens them.
 *
 * <h2>What the platform tier is exempted from, and what it is not</h2>
 *
 * <p>Exempt from the ROLE CEILING only — see {@link UserLifecycleService#setActive(UUID, UUID,
 * ActorTier, UUID, boolean)} for why a ceiling check against a {@code platform_users} id would
 * refuse every real account rather than protect one. Everything else still applies: the tenant GUC
 * is set, the query carries the tenant predicate, so a user of another tenant is 404 and not a
 * cross-tenant write; and <b>none of these four operations grants anything</b>. There is no path
 * from this controller to a role assignment, which is the property 13-02 split {@code rbac.manage}
 * to protect and which the platform tier must not be able to undo from above.
 *
 * <h2>The two headers</h2>
 *
 * <p>{@code X-Tenant-Id} scopes the row-level-security GUC and the query predicate.
 *
 * <p>{@code X-Acting-User-Id} is the acting {@code platform_users.id}, asserted by
 * platform-admin-service from the {@code sub} of a verified control-plane token, and it is
 * <b>required</b> — see {@link UserLifecycleInternalController#ACTING_USER_HEADER} for the full
 * account of why it is an identity and never an entitlement, and for the three independent controls
 * that stop a client supplying one. It is not used for authorization here (there is nothing to
 * compare it against) and it is deliberately NOT written into the tenant's audit trail, because it
 * belongs to a different id space and a consumer resolving it against {@code auth_db.users} would
 * name somebody who did not do it. It is logged, and the durable record of WHO is
 * {@code platform_db.platform_admin_audit}, written by the caller in the same request.
 *
 * <p><b>No {@code reason} field, deliberately.</b> The reason is mandatory at the platform tier and
 * is recorded there. Accepting one here and discarding it — this service has no column and no
 * payload field for it — would be a control that looks enforced and is not.
 */
@RestController
@RequestMapping("/internal/auth/platform/users")
public class PlatformUserSecurityInternalController {

    private static final Logger log =
        LoggerFactory.getLogger(PlatformUserSecurityInternalController.class);

    private static final String TENANT_HEADER = "X-Tenant-Id";

    private final UserLifecycleService userLifecycleService;

    public PlatformUserSecurityInternalController(UserLifecycleService userLifecycleService) {
        this.userLifecycleService = userLifecycleService;
    }

    /** Flag off, refresh sessions revoked, row and assignments untouched. Never deletes. */
    @PostMapping("/{userId}/deactivate")
    public ResponseEntity<ApiResponse<UserDetail>> deactivate(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = UserLifecycleInternalController.ACTING_USER_HEADER,
                required = false) UUID actingPlatformUserId,
            @PathVariable UUID userId) {
        requireActingPlatformUser(actingPlatformUserId, "deactivate", tenantId, userId);
        return ResponseEntity.ok(ApiResponse.ok(userLifecycleService.setActive(
            tenantId, actingPlatformUserId, ActorTier.PLATFORM, userId, false)));
    }

    /** Flag on. Sessions are deliberately NOT restored — see {@link UserLifecycleService}. */
    @PostMapping("/{userId}/reactivate")
    public ResponseEntity<ApiResponse<UserDetail>> reactivate(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = UserLifecycleInternalController.ACTING_USER_HEADER,
                required = false) UUID actingPlatformUserId,
            @PathVariable UUID userId) {
        requireActingPlatformUser(actingPlatformUserId, "reactivate", tenantId, userId);
        return ResponseEntity.ok(ApiResponse.ok(userLifecycleService.setActive(
            tenantId, actingPlatformUserId, ActorTier.PLATFORM, userId, true)));
    }

    /**
     * Clear the brute-force lockout counter and timestamp.
     *
     * <p>Not the same thing as reactivating an account — {@code locked_until} is a fifteen-minute
     * cooldown that expires on its own, {@code is_active} is the durable lock. Both are exposed
     * separately so an operator cannot mistake one for the other.
     */
    @PostMapping("/{userId}/unlock")
    public ResponseEntity<ApiResponse<UserSecurityState>> unlock(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = UserLifecycleInternalController.ACTING_USER_HEADER,
                required = false) UUID actingPlatformUserId,
            @PathVariable UUID userId) {
        requireActingPlatformUser(actingPlatformUserId, "unlock", tenantId, userId);
        return ResponseEntity.ok(ApiResponse.ok(userLifecycleService.clearLockout(tenantId, userId)));
    }

    /**
     * Revoke every live refresh session without touching the account.
     *
     * <p>Already-issued ACCESS tokens survive until they expire; the response's
     * {@code sessionsRevoked} counts refresh sessions only. See {@link
     * UserLifecycleService#revokeSessions} for the residual window and why it is stated rather than
     * glossed.
     */
    @PostMapping("/{userId}/revoke-sessions")
    public ResponseEntity<ApiResponse<UserSecurityState>> revokeSessions(
            @RequestHeader(TENANT_HEADER) UUID tenantId,
            @RequestHeader(value = UserLifecycleInternalController.ACTING_USER_HEADER,
                required = false) UUID actingPlatformUserId,
            @PathVariable UUID userId) {
        requireActingPlatformUser(actingPlatformUserId, "revoke-sessions", tenantId, userId);
        return ResponseEntity.ok(ApiResponse.ok(userLifecycleService.revokeSessions(tenantId, userId)));
    }

    /**
     * Declared {@code required = false} on each mapping and rejected here, for the reason
     * {@link UserLifecycleInternalController} records: Spring's own refusal is a 400 that a caller
     * cannot distinguish from a malformed body, and this is an authorization failure.
     *
     * <p>The log line is the second half of why the header is mandatory even though it is not
     * compared against anything: an operation on a tenant's account taken from outside that tenant
     * is one an operator wants to see without querying a database.
     */
    private static void requireActingPlatformUser(UUID actingPlatformUserId, String operation,
                                                  UUID tenantId, UUID userId) {
        if (actingPlatformUserId == null) {
            throw new ActingUserRequiredException(
                "POST /internal/auth/platform/users/{userId}/" + operation);
        }
        log.info("[auth][platform-tier] {} by platform user {} on tenant {} user {}",
            operation, actingPlatformUserId, tenantId, userId);
    }
}
