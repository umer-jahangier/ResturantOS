package io.restaurantos.platform.service;

import feign.FeignException;
import io.restaurantos.platform.client.AuthInternalClient;
import io.restaurantos.platform.client.AuthUserDirectoryClient;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserDetailData;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserSecurityData;
import io.restaurantos.platform.entity.PlatformAdminAuditEntity.PlatformAdminAction;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.function.Supplier;

/**
 * Platform-tier administration of a TENANT's users (13-13, D-16; extended by the superadmin plan).
 *
 * <p>Five operations, all of them audited through one path ({@code perform}): password reset,
 * deactivate, reactivate, unlock and revoke-sessions. <b>None of them can grant anything.</b> There
 * is deliberately no role assignment here and none should be added — see {@link PlatformRbacService}
 * for why the platform tier's view of the authorization model is read-only, and why adding a write
 * would hand back the escalation 13-02 split {@code rbac.manage} to prevent.
 *
 * <p>The two halves of the trail, and neither substitutes for the other: auth-service publishes the
 * tenant-side event ({@code ADMIN_PASSWORD_RESET}, {@code USER_DEACTIVATED},
 * {@code USER_REACTIVATED}) carrying NO platform id in any actor column, because a
 * {@code platform_users} id resolved against {@code auth_db.users} names somebody who did not act;
 * and {@code platform_db.platform_admin_audit} carries who, why, and what happened. Unlock and
 * revoke-sessions publish no tenant event at all and that row is their only record — a known
 * asymmetry, recorded on each method rather than glossed.
 *
 * <h2>Why the platform tier needs this at all</h2>
 *
 * <p>13-09 (D-31) resolved that self-service forgot-password ships disabled — nothing consumes
 * {@code PASSWORD_RESET_REQUESTED} because {@code notification-service} has no source files — so
 * the only way back into an account is an administrator. When the account in question is the
 * tenant's OWNER, or the tenant's only remaining administrator, there is nobody inside the tenant
 * who can do it: the role ceiling correctly refuses a lesser role resetting a greater one, which is
 * the whole point of it. Without a platform-tier reset a tenant that loses its owner's password
 * loses the tenant.
 *
 * <h2>What that costs, stated rather than glossed</h2>
 *
 * <p><b>A SuperAdmin can take over any account in any tenant</b> (T-13-13-F, disposition:
 * accept). That is a deliberate support capability and it is not compensated by a check — no check
 * would be honest, because the operator legitimately needs it. It is compensated by evidence and by
 * narrowness:
 *
 * <ul>
 *   <li>auth-service emits {@code ADMIN_PASSWORD_RESET} naming the acting platform user, the target,
 *       the tier and a required reason — the durable trail, in the tenant's own outbox;</li>
 *   <li>the acting id comes from the {@code sub} of an RS256-verified control-plane token and is
 *       never read from a body or a header;</li>
 *   <li>the route is behind the class-level {@code SUPER_ADMIN} gate and the gateway's
 *       platform rate limit, and a platform token is short-lived and not refreshable (13-05);</li>
 *   <li>the target's forced-change flag is set, so the operator's temporary password stops working
 *       the moment the tenant's own person uses it.</li>
 * </ul>
 *
 * <p>The tenant is resolved here before delegating, so a well-formed but unknown tenant id is a 404
 * from this service rather than an upstream call that quietly resets nothing.
 */
@Service
public class PlatformUserAdminService {

    private static final Logger log = LoggerFactory.getLogger(PlatformUserAdminService.class);

    /**
     * The tier discriminator auth-service reads to decide whether the role ceiling applies. A
     * constant, asserted by this service; there is no request path that can influence it.
     */
    private static final String PLATFORM_TIER = "PLATFORM";

    private final AuthInternalClient authInternalClient;
    private final AuthUserDirectoryClient userDirectoryClient;
    private final TenantRepository tenantRepository;
    private final PlatformAdminAuditRecorder audit;

    public PlatformUserAdminService(AuthInternalClient authInternalClient,
                                    AuthUserDirectoryClient userDirectoryClient,
                                    TenantRepository tenantRepository,
                                    PlatformAdminAuditRecorder audit) {
        this.authInternalClient = authInternalClient;
        this.userDirectoryClient = userDirectoryClient;
        this.tenantRepository = tenantRepository;
        this.audit = audit;
    }

    /**
     * Reset a tenant user's password as a platform operator.
     *
     * @param actingPlatformUserId the {@code platform_users.id} from the verified control-plane
     *                             token — never a body field, never a header
     * @return the one-time temporary password, to be delivered out of band
     */
    public AuthInternalClient.AdminResetData reset(UUID tenantId, UUID targetUserId,
                                                   UUID actingPlatformUserId, String reason) {
        return perform(PlatformAdminAction.USER_PASSWORD_RESET, tenantId, targetUserId,
            actingPlatformUserId, reason,
            () -> {
                // Logged at INFO because a platform operator taking over a tenant account is an
                // event an operator wants to see without querying the outbox. The temporary
                // password is NOT here and must never be: this line, the ADMIN_PASSWORD_RESET
                // event and the platform_admin_audit row are the three records of the reset, and
                // none of them may carry the credential.
                log.info("[platform-admin] password reset by platform user {} on tenant {} user {}"
                        + " — reason: {}", actingPlatformUserId, tenantId, targetUserId, reason);
                return authInternalClient.resetUserPassword(targetUserId, tenantId,
                    actingPlatformUserId,
                    new AuthInternalClient.AdminResetRequest(PLATFORM_TIER, reason)).data();
            },
            // Deliberately says nothing about the credential — not its length, not a prefix,
            // nothing. platform_admin_audit is plain text that nothing purges (the lesson
            // idempotency_keys.response_json taught this service in 13-10).
            result -> "mustChangePassword=" + result.mustChangePassword());
    }

    /**
     * Deactivate a tenant user — the durable lock, and the one an operator usually means.
     *
     * <p>Flag off, every live refresh session revoked, row and assignments untouched. Nothing is
     * deleted, so audit rows, orders and journal entries that reference the user id stay
     * resolvable, and a reactivated account comes back with the roles it had.
     *
     * <p><b>Already-issued ACCESS tokens survive until they expire.</b> They are stateless and
     * there is no revocation list; the residual window is the access-token TTL. Stated rather than
     * glossed, because a console that renders this as "access removed" is overstating it by that
     * window.
     *
     * <p>Goes to {@code /internal/auth/platform/users/...}, a different path from the tenant tier's
     * deactivate, so the platform tier's exemption from the role ceiling is structural rather than
     * a flag in a body. See {@code PlatformUserSecurityInternalController} for what that exemption
     * covers — the ceiling, and nothing else. The tenant boundary still holds.
     */
    public UserDetailData deactivate(UUID tenantId, UUID targetUserId,
                                     UUID actingPlatformUserId, String reason) {
        return perform(PlatformAdminAction.USER_DEACTIVATED, tenantId, targetUserId,
            actingPlatformUserId, reason,
            () -> userDirectoryClient.deactivate(targetUserId, tenantId, actingPlatformUserId).data(),
            result -> "active=false");
    }

    /**
     * Reactivate a tenant user.
     *
     * <p><b>Sessions are deliberately not restored.</b> Revocation is not reversible and should not
     * be: the sessions revoked at deactivation may have been on a device the person no longer has.
     * A reactivated user logs in again, which is one password prompt and is the point at which the
     * platform re-establishes who is holding the account.
     *
     * <p>An account with no active branch-role assignment is still unusable after this — permission
     * resolution fails before a token is minted. The detail endpoint reports that as
     * {@code loginable=false} with the reason, which is the honest way to say "reactivated and
     * still cannot log in".
     */
    public UserDetailData reactivate(UUID tenantId, UUID targetUserId,
                                     UUID actingPlatformUserId, String reason) {
        return perform(PlatformAdminAction.USER_REACTIVATED, tenantId, targetUserId,
            actingPlatformUserId, reason,
            () -> userDirectoryClient.reactivate(targetUserId, tenantId, actingPlatformUserId).data(),
            result -> "active=true");
    }

    /**
     * Clear a brute-force lockout — NOT the same operation as reactivating.
     *
     * <p>{@code users.locked_until} is a fifteen-minute cooldown auth-service writes after repeated
     * failed logins and it expires on its own; {@code is_active} is the durable lock. They are
     * exposed as two operations so an operator cannot clear a timer and believe they disabled an
     * account, or deactivate an account when all the user needed was the cooldown cleared.
     *
     * <p><b>Known asymmetry, stated rather than hidden:</b> this publishes NO tenant-side event.
     * There is no {@code USER_UNLOCKED} type in the shared audit allow-list and adding one is a
     * shared-lib change rippling through sixteen services and a build-enforced closure test, for an
     * action that grants nothing and revokes nothing. The {@code platform_admin_audit} row is
     * therefore the ONLY record, and a tenant reading only its own {@code audit_events} will not
     * see it.
     */
    public UserSecurityData unlock(UUID tenantId, UUID targetUserId,
                                   UUID actingPlatformUserId, String reason) {
        return perform(PlatformAdminAction.USER_UNLOCKED, tenantId, targetUserId,
            actingPlatformUserId, reason,
            () -> userDirectoryClient.unlock(targetUserId, tenantId, actingPlatformUserId).data(),
            result -> "lockedUntil=" + result.lockedUntil() + ", failedLoginCount="
                + result.failedLoginCount());
    }

    /**
     * Revoke every live refresh session without touching the account — "sign this person out
     * everywhere".
     *
     * <p>This is the whole of what the auth model supports, and the bound must reach the caller:
     * <b>already-issued ACCESS tokens stay valid until they expire.</b> {@code sessionsRevoked}
     * counts refresh sessions only.
     *
     * <p>{@code sessionsRevoked=0} means the user held no live session, not that the call did
     * nothing — the same distinction {@code UsageMeter} draws between a measured zero and an
     * unmeasured one, which is why the count is returned rather than a bare 204.
     *
     * <p>Publishes no tenant-side event, for the reason {@link #unlock} records.
     */
    public UserSecurityData revokeSessions(UUID tenantId, UUID targetUserId,
                                           UUID actingPlatformUserId, String reason) {
        return perform(PlatformAdminAction.USER_SESSIONS_REVOKED, tenantId, targetUserId,
            actingPlatformUserId, reason,
            () -> userDirectoryClient.revokeSessions(targetUserId, tenantId, actingPlatformUserId)
                .data(),
            result -> "sessionsRevoked=" + result.sessionsRevoked());
    }

    // ───────────────────────────────── internals ─────────────────────────────────

    /**
     * The shape every platform-tier mutation has: resolve the tenant, act, record — and record the
     * refusal too.
     *
     * <p><b>One implementation, deliberately.</b> Five endpoints each writing their own audit call
     * is five chances for the sixth to be added without one, and "the mutation that forgot to audit
     * itself" is not a defect anybody notices until it is needed. Here, an operation that is not
     * routed through this method is one that does not compile into the surface at all.
     *
     * <p>The tenant is resolved LOCALLY first, so a well-formed but unknown tenant id is a 404 from
     * this service rather than an upstream call that quietly does nothing. That refusal is audited
     * as well: an operator repeatedly aiming at ids that do not resolve is exactly the pattern an
     * abuse review looks for.
     *
     * <p>Upstream refusals are re-thrown unchanged so {@code PlatformAdminExceptionHandler} can map
     * them — a 404 from auth-service must stay a 404 and not become a 500. The audit row is written
     * FIRST, in its own transaction, so the record survives the exception that is about to
     * propagate.
     */
    private <T> T perform(PlatformAdminAction action, UUID tenantId, UUID targetUserId,
                          UUID actingPlatformUserId, String reason,
                          Supplier<T> operation, java.util.function.Function<T, String> describe) {
        if (!tenantRepository.existsById(tenantId)) {
            audit.recordRefusal(action, actingPlatformUserId, tenantId, targetUserId, reason,
                "tenant not found in platform_db; nothing was delegated");
            throw new ResourceNotFoundException("Tenant not found: " + tenantId);
        }
        T result;
        try {
            result = operation.get();
        } catch (FeignException upstream) {
            audit.recordRefusal(action, actingPlatformUserId, tenantId, targetUserId, reason,
                "auth-service refused: status=" + upstream.status());
            throw upstream;
        }
        audit.recordSuccess(action, actingPlatformUserId, tenantId, targetUserId, reason,
            result == null ? null : describe.apply(result));
        return result;
    }
}
