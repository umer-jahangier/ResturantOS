package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.InvalidUserRequestException;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.payload.AdminPasswordResetPayload;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Administrator-initiated password reset — ONE routine, two authorised entry points (D-16, D-18).
 *
 * <h2>Why this is not optional</h2>
 *
 * <p>13-09 (D-31) resolved that self-service forgot-password ships <b>disabled</b> in this
 * milestone: {@code services/notification-service} is an active Maven module containing a
 * {@code pom.xml} and a {@code README.md} and nothing else, so no consumer of
 * {@code PASSWORD_RESET_REQUESTED} exists and there is no channel that can deliver a token to a
 * user who has forgotten their password. <b>This routine is therefore the only working way to set a
 * user's password in the platform</b>, and 13-15's seed script depends on it. The temporary
 * password is returned to the calling administrator to be handed over out of band, because there is
 * nothing to email it with.
 *
 * <h2>It composes the shared policy; it reimplements none of it</h2>
 *
 * <p>History append, session revocation, lockout clearing and the temporary-password generator all
 * belong to {@link PasswordPolicyService} and {@link ProvisioningAdminService} and are called, not
 * copied. Two reset implementations that agree on day one and drift afterwards is the recurring
 * finding of the audit that produced this phase — "reset clears the lockout but change does not" is
 * exactly that shape — and after 13-04, 13-08 and 13-09 there is precisely one correct way to do
 * each of these steps.
 *
 * <h2>Row-level security</h2>
 *
 * <p>The tenant GUC is the FIRST statement of the transaction, before any RLS-scoped read. Six
 * paths in this phase shipped green-and-broken for omitting that, because Testcontainers' Postgres
 * user is a SUPERUSER and superusers bypass row security entirely while the live {@code auth_user}
 * is {@code NOSUPERUSER NOBYPASSRLS}. And the tenant predicate is carried in the QUERY as well —
 * {@link UserRepository#findByIdForTenant} — so the boundary is enforced twice by independent
 * mechanisms, one of which CI can assert.
 *
 * <h2>The cooldown question 13-09 left to this plan, answered</h2>
 *
 * <p>13-09 asked whether an ADMIN reset should be subject to the per-account cooldown it added.
 * <b>It is not, and it cannot be: this routine issues no token at all.</b> It sets a password
 * directly, so {@code issueSingleUseToken} — where the cooldown and its advisory lock live — is
 * never reached. That is the right answer on the merits too. The cooldown exists to stop an
 * anonymous caller making one account receive unlimited messages, and to stop the refusal becoming
 * an account-existence oracle; neither applies to a call that is authenticated, authorised,
 * tier-gated, reason-bearing and audited by name. What bounds an admin reset instead is the
 * authority gate at each tier, the role ceiling below, the gateway's per-IP budget, and the audit
 * row itself.
 */
@Service
public class AdminPasswordResetService {

    /**
     * Which tier the acting administrator belongs to — and therefore which id space
     * {@code actingAdministratorId} lives in and whether the role ceiling applies.
     *
     * <p>A single argument rather than two callers each carrying their own guard: the rule "who may
     * reset whom" then has one implementation and cannot drift between the tenant surface and the
     * platform surface, which is the failure this phase keeps finding.
     *
     * <p>Asserted by the CALLING SERVICE from a verified JWT, exactly like {@code X-Acting-User-Id}
     * (13-11). It is not reachable from a client: the gateway maps no route to
     * {@code /internal/**}, {@code InternalServiceFilter} demands the shared secret, and the two
     * services that hold it each send a constant.
     */
    public enum ActorTier {
        /**
         * A tenant administrator resetting one of their own tenant's users. Bounded by
         * {@link RoleCeiling}: they may not reset a user holding a role above their own.
         */
        TENANT,

        /**
         * A platform operator (SuperAdmin) resetting any user of any tenant.
         *
         * <p>Deliberately unbounded by the role ceiling, and T-13-13-F accepts it: platform support
         * exists to rescue a tenant that has locked itself out, which by definition means resetting
         * that tenant's highest role. There is also nothing to compare against — a platform id is a
         * {@code platform_users} row that holds no {@code user_branch_roles} at all, so a ceiling
         * check would resolve the empty permission set and refuse every reset. What compensates is
         * the SuperAdmin authority gate, the short non-refreshable platform token, the rate-limited
         * platform route, and this event.
         */
        PLATFORM
    }

    /**
     * The outcome, including the temporary password — which crosses back to the caller EXACTLY
     * ONCE and exists nowhere else.
     *
     * <p>Not in a log, not in the database (only its bcrypt hash), not in the audit event, and
     * <b>not in an idempotency record</b>: 13-10 found {@code platform_db.idempotency_keys
     * .response_json} is a plain text column nothing ever purges, so a credential written there is
     * permanent. Neither entry point takes an idempotency key, and neither may grow one that
     * captures this response.
     *
     * <p>{@link #toString()} is overridden because a record's generated one prints every component,
     * so a single careless {@code log.debug} of this type would put a live credential in a file.
     */
    public record AdminResetResult(UUID userId, String email, String tempPassword,
                                   boolean mustChangePassword) {
        @Override
        public String toString() {
            return "AdminResetResult[userId=" + userId + ", email=" + email
                + ", tempPassword=<redacted>, mustChangePassword=" + mustChangePassword + "]";
        }
    }

    private final UserRepository userRepository;
    private final UserBranchRoleRepository userBranchRoleRepository;
    private final PasswordPolicyService passwordPolicyService;
    private final RoleCeiling roleCeiling;
    private final PasswordEncoder passwordEncoder;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public AdminPasswordResetService(UserRepository userRepository,
                                     UserBranchRoleRepository userBranchRoleRepository,
                                     PasswordPolicyService passwordPolicyService,
                                     RoleCeiling roleCeiling,
                                     PasswordEncoder passwordEncoder,
                                     EventPublisher eventPublisher,
                                     TenantContext tenantContext,
                                     EntityManager entityManager) {
        this.userRepository = userRepository;
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.passwordPolicyService = passwordPolicyService;
        this.roleCeiling = roleCeiling;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    /**
     * Reset one user's password on an administrator's behalf.
     *
     * <p>The order of operations is the safety:
     *
     * <ol>
     *   <li><b>tenant GUC</b>, before any row-level-security-scoped statement;</li>
     *   <li><b>resolve the target within the tenant</b> — another tenant's id is 404, never 403, so
     *       an administrator cannot walk ids and learn the shape of the rest of the platform;</li>
     *   <li><b>the ceiling</b>, evaluated against the target's CURRENT roles and refused before a
     *       password is generated or a row is written, so an over-reach costs nothing and leaves
     *       nothing behind;</li>
     *   <li>history append <b>before</b> the hash is overwritten — afterwards it files the brand-new
     *       password as a historical one, which both loses the entry that should have been kept and
     *       makes the next change fail its own reuse check;</li>
     *   <li>the new hash, the forced-change flag and the lockout clear, in one save;</li>
     *   <li>retire outstanding single-use tokens, then revoke refresh sessions;</li>
     *   <li>the audit event, inside this same transaction so it cannot record a reset that rolled
     *       back — {@code EventPublisher} is outbox-backed for exactly that reason.</li>
     * </ol>
     *
     * <p><b>The reuse rule is deliberately NOT applied.</b> {@code rejectIfPasswordReused} exists to
     * stop a HUMAN cycling back to a password they have used before; the value here is 16 random
     * characters from {@link java.security.SecureRandom} that nobody chose and nobody will retype,
     * and refusing a reset because a generated string collided with history would be an outage with
     * no cause a user could act on. The account's own history is still appended, so the rule keeps
     * applying to every password the human subsequently chooses.
     *
     * @param tenantId       the tenant that owns the target
     * @param targetUserId   whose password is being reset
     * @param actingAdminId  WHO is doing it — the subject of a verified JWT, asserted by the calling
     *                       service, never read from a request body
     * @param actorTier      which tier that id belongs to; see {@link ActorTier}
     * @param reason         required, and recorded in the audit event
     * @throws ResourceNotFoundException if the target is not a user of this tenant (404)
     * @throws io.restaurantos.auth.exception.RoleCeilingExceededException if a tenant-tier caller
     *         aims above its own permissions (403)
     */
    @Transactional
    public AdminResetResult reset(UUID tenantId, UUID targetUserId, UUID actingAdminId,
                                  ActorTier actorTier, String reason) {
        // FIRST statement of the transaction. Everything below reads or writes a FORCE ROW LEVEL
        // SECURITY table, and a GUC set late lands on a different connection than the statements it
        // is supposed to scope.
        setTenantGuc(tenantId);

        String trimmedReason = reason == null ? "" : reason.trim();
        if (trimmedReason.isEmpty()) {
            throw new InvalidUserRequestException(
                "A reason is required: every administrative password reset is audited by actor, "
                    + "target and reason, and a row that cannot say why is one somebody has to "
                    + "interpret rather than read");
        }
        if (actorTier == null) {
            throw new InvalidUserRequestException("An actorTier of TENANT or PLATFORM is required");
        }

        UserEntity target = userRepository.findByIdForTenant(targetUserId, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("User not found: " + targetUserId));

        requireMayReset(actingAdminId, actorTier, targetUserId);

        String tempPassword = ProvisioningAdminService.generateTempPassword();

        passwordPolicyService.appendCurrentPasswordToHistory(target);
        target.setPasswordHash(passwordEncoder.encode(tempPassword));
        // D-16: the credential the administrator has just read out over the phone must not become
        // the account's permanent one. 13-08 made this flag binding at login.
        target.setMustChangePassword(true);
        // D-18: without this the reset user is STILL locked out, having already done the only thing
        // the error told them to. Delegated to 13-04's shared routine rather than reimplemented.
        passwordPolicyService.clearLockout(target);
        userRepository.saveAndFlush(target);

        // An account being reset is frequently an account somebody has lost control of. A reset
        // token minted before this call would let whoever holds it set a password of their own
        // choosing and, because reset-confirm clears must_change_password (13-09), bypass the
        // forced-change gate entirely — so the takeover the administrator is trying to undo would
        // survive the undoing. Retired here for that reason; the target's next login mints a fresh
        // forced-change token in any case.
        passwordPolicyService.invalidateOutstandingTokens(targetUserId);
        passwordPolicyService.revokeActiveRefreshSessions(targetUserId);

        // DomainEventPublisher reads the outbox row's tenant_id from TenantContext, and this
        // request carries no JWT — /internal/** is authorized by a shared secret, not a token — so
        // nothing has populated it. Without this the publish throws and the whole reset rolls back;
        // PasswordResetService.request sets it for the same reason on the public reset path.
        //
        // The user id is deliberately NOT set here. At the PLATFORM tier the acting id is a
        // platform_users row, and putting a foreign id space into a tenant-scoped context would
        // make anything that later reads it draw a false conclusion. Who did it is recorded where
        // it belongs — in the payload's actingAdministratorId, alongside the tier that says which
        // id space it is.
        tenantContext.set(tenantId, null, null, null);

        eventPublisher.publish(
            AdminPasswordResetPayload.EXCHANGE,
            AdminPasswordResetPayload.ROUTING_KEY,
            AdminPasswordResetPayload.EVENT_TYPE,
            null,
            new AdminPasswordResetPayload(tenantId, actingAdminId, actorTier.name(),
                targetUserId, target.getEmail(), trimmedReason, Instant.now()));

        return new AdminResetResult(targetUserId, target.getEmail(), tempPassword, true);
    }

    /**
     * A tenant-tier administrator may not reset a user who holds a role above their own.
     *
     * <p>Delegated to {@link RoleCeiling#requireMayAdminister}, which is the single owner of the
     * rule and is already shared by the role picker (13-07) and the user-lifecycle write path
     * (13-11). <b>Not forked</b>: a second, weaker statement of a security rule that already has an
     * owner is how a picker comes to hide a role the write path accepts.
     *
     * <p>Setting someone's password is strictly stronger than editing their profile — it is taking
     * their account — so the rule that already bounds "may I deactivate the OWNER" must bound this
     * too. A TENANT_ADMIN resetting the OWNER is a privilege inversion: they would then log in as
     * the only holder of {@code rbac.manage} in that tenant.
     *
     * <p>The PLATFORM tier is exempt. See {@link ActorTier#PLATFORM} for why that is a decision
     * rather than an omission.
     */
    private void requireMayReset(UUID actingAdminId, ActorTier actorTier, UUID targetUserId) {
        if (actorTier == ActorTier.PLATFORM) {
            return;
        }
        List<String> targetRoles = userBranchRoleRepository.findByUserIdAndActiveTrue(targetUserId)
            .stream()
            .map(UserBranchRoleEntity::getRoleCode)
            .distinct()
            .toList();
        roleCeiling.requireMayAdminister(actingAdminId, targetRoles);
    }

    /** Transaction-local tenant GUC. Must be the first statement of the transaction. */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
