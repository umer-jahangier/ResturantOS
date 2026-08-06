package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.PasswordReuseException;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import jakarta.persistence.EntityManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;

/**
 * The rules that must hold every time a password changes, wherever it changes from.
 *
 * <p><b>Why this class exists.</b> All of this lived privately inside {@code PasswordResetService},
 * which meant the reset flow was the only flow that obeyed it. The audit's recurring finding is two
 * code paths that agree on day one and drift afterwards, and "reset enforces password reuse but
 * self-service change does not" is precisely that shape — with the added property that the weaker
 * path is the one users take voluntarily. Three later plans in this phase change a password
 * (13-08 forced change, 13-09 reset hardening, 13-13 admin-initiated reset); each of them calls
 * into here rather than growing its own copy.
 *
 * <p>The methods are deliberately small and separately callable rather than one
 * {@code applyNewPassword} that does everything: the four flows differ in what they verify BEFORE
 * the change and in what they do after, and a single monolith would have to grow a boolean per
 * caller. Each of them is a no-op-safe operation on an already-loaded entity, so ordering is the
 * caller's — see {@link #appendCurrentPasswordToHistory} for the one ordering constraint that
 * matters.
 *
 * <p>Every method here must be called inside a transaction that also writes the new hash, so a
 * failure cannot leave history appended against a password that never changed.
 */
@Service
public class PasswordPolicyService {

    /**
     * How far back the reuse rule looks. Matches the repository finder's name; changing one without
     * the other silently changes the policy.
     */
    public static final int HISTORY_DEPTH = 5;

    private final PasswordHistoryRepository passwordHistoryRepository;
    private final RefreshSessionRepository refreshSessionRepository;
    private final EntityManager entityManager;
    private final PasswordEncoder passwordEncoder;

    public PasswordPolicyService(PasswordHistoryRepository passwordHistoryRepository,
                                 RefreshSessionRepository refreshSessionRepository,
                                 EntityManager entityManager,
                                 PasswordEncoder passwordEncoder) {
        this.passwordHistoryRepository = passwordHistoryRepository;
        this.refreshSessionRepository = refreshSessionRepository;
        this.entityManager = entityManager;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Refuses a new password that equals the current one or any of the last {@value #HISTORY_DEPTH}
     * historical ones.
     *
     * <p>Costs up to six bcrypt comparisons at cost 12, which is deliberate and is why it runs
     * after the caller has already established who the user is: it is not a check to run on
     * unauthenticated input.
     *
     * @throws PasswordReuseException with a message that names no password and no account
     */
    public void rejectIfPasswordReused(UserEntity user, String newPassword) {
        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) {
            throw new PasswordReuseException("Cannot reuse a recent password");
        }
        for (PasswordHistoryEntity history :
                passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(user.getId())) {
            if (passwordEncoder.matches(newPassword, history.getPasswordHash())) {
                throw new PasswordReuseException("Cannot reuse a recent password");
            }
        }
    }

    /**
     * Appends the user's CURRENT password hash to history.
     *
     * <p><b>Call this before overwriting {@code passwordHash}, never after.</b> Called afterwards it
     * files the brand-new password as a historical one, which both loses the entry that should have
     * been kept and makes the next change fail its own reuse check for a password the user never
     * had before. The method takes the entity rather than a hash so there is exactly one way to get
     * this wrong instead of two.
     */
    public void appendCurrentPasswordToHistory(UserEntity user) {
        PasswordHistoryEntity history = new PasswordHistoryEntity();
        history.setTenantId(user.getTenantId());
        history.setUserId(user.getId());
        history.setPasswordHash(user.getPasswordHash());
        passwordHistoryRepository.save(history);
    }

    /**
     * Revokes every unrevoked refresh session for the user.
     *
     * <p>Scoped to one user id: a password change must not disturb anyone else's sessions, and the
     * repository finder is the only thing keeping that true.
     *
     * <p>Note what this does NOT do: already-issued access tokens stay valid until they expire.
     * They are stateless by design and there is no revocation list; the residual window is the
     * access-token TTL and is asserted explicitly by the live script rather than assumed away.
     */
    public void revokeActiveRefreshSessions(UUID userId) {
        refreshSessionRepository.findByUserIdAndRevokedAtIsNull(userId).forEach(session -> {
            session.setRevokedAt(Instant.now());
            refreshSessionRepository.save(session);
        });
    }

    /**
     * Clears the failed-login counter and the lockout timestamp.
     *
     * <p>New behaviour, and the reason it is here rather than in one caller: a user who has just
     * proved knowledge of their password (or of a valid reset token) and chosen a new one is not
     * the user the lockout was protecting against, but without this they stay locked out with no
     * explanation and no action available to them — they have already done the only thing the
     * error told them to. 13-09 wires this into the reset path; 13-04 wires it into change.
     *
     * <p>Does not save: the caller is writing the entity anyway, and a second save here would make
     * the operation look independently durable when it is not.
     */
    public void clearLockout(UserEntity user) {
        user.setFailedLoginCount(0);
        user.setLockedUntil(null);
    }

    /**
     * Sets the row-level-security tenant GUC for the current transaction.
     *
     * <p>Transaction-local ({@code is_local = true}), so it cannot outlive the transaction on a
     * pooled connection. Must be issued before the first RLS-scoped read of the transaction, so
     * that the GUC and the read land on the same connection — this codebase has a documented prior
     * bug of exactly that shape (see {@code TenantAwareDataSource}'s class javadoc).
     */
    public void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
