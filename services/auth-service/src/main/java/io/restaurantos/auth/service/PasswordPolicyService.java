package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.PasswordResetTokenEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.exception.PasswordReuseException;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.auth.repository.PasswordResetTokenRepository;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import jakarta.persistence.EntityManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
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

    /**
     * Separates a token's tenant routing prefix from its secret half. A dot, because base64url's
     * alphabet does not contain one, so the split is unambiguous however the secret comes out.
     */
    private static final String TENANT_PREFIX_SEPARATOR = ".";

    /**
     * Which flow a single-use password token belongs to.
     *
     * <p>The two purposes share one table and one row-level-security policy, and are kept apart by
     * this discriminator plus a database check constraint. They must never be interchangeable: a
     * reset token is obtained by proving control of an email address, a forced-change token by
     * proving knowledge of the current password. Allowing either to be redeemed where the other is
     * expected would let the weaker proof stand in for the stronger one (threat T-13-08-E).
     *
     * <p>{@link #dbValue} is the string that reaches the column, spelled out rather than derived
     * from {@link #name()} so a Java-side rename cannot silently change what the check constraint
     * sees.
     */
    public enum TokenPurpose {
        /**
         * Forgot-password. Thirty minutes, matching the pre-existing behaviour of that flow.
         */
        RESET("RESET", Duration.ofMinutes(30), "Invalid or expired reset token"),

        /**
         * Forced change at login (D-17).
         *
         * <p>Ten minutes, and deliberately much shorter than a reset token's thirty. A reset token
         * travels by email and has to survive a human noticing the message; this one is handed
         * straight back on the refused login, so its entire useful life is the seconds between the
         * refusal and the change form being submitted. Every second beyond that is a window in
         * which a token that grants a password change sits somewhere it could be read from.
         *
         * <p>Its failure message is the SAME string every other authentication failure in this
         * service uses. That is not tidiness: the forced-change endpoint is public, so a distinct
         * message here would tell an unauthenticated caller the difference between "no such token",
         * "expired", "already used" and "wrong password" — and, with it, whether an account exists.
         */
        FORCED_CHANGE("FORCED_CHANGE", Duration.ofMinutes(10), "Invalid credentials");

        private final String dbValue;
        private final Duration ttl;
        private final String genericFailureMessage;

        TokenPurpose(String dbValue, Duration ttl, String genericFailureMessage) {
            this.dbValue = dbValue;
            this.ttl = ttl;
            this.genericFailureMessage = genericFailureMessage;
        }

        public String dbValue() {
            return dbValue;
        }

        public Duration ttl() {
            return ttl;
        }

        public String genericFailureMessage() {
            return genericFailureMessage;
        }
    }

    /** The raw token — which the caller must hand out and must not store — and when it dies. */
    public record IssuedToken(String rawToken, Instant expiresAt) {
        @Override
        public String toString() {
            // A record's generated toString prints every component, so one careless log.debug of an
            // IssuedToken would put a live credential in a log file. Overridden so it cannot.
            return "IssuedToken[rawToken=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }

    /** Who a successfully redeemed token belonged to. Never carries the token itself. */
    public record RedeemedToken(UUID tenantId, UUID userId) {}

    private final PasswordHistoryRepository passwordHistoryRepository;
    private final RefreshSessionRepository refreshSessionRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final EntityManager entityManager;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordPolicyService(PasswordHistoryRepository passwordHistoryRepository,
                                 RefreshSessionRepository refreshSessionRepository,
                                 PasswordResetTokenRepository passwordResetTokenRepository,
                                 EntityManager entityManager,
                                 PasswordEncoder passwordEncoder) {
        this.passwordHistoryRepository = passwordHistoryRepository;
        this.refreshSessionRepository = refreshSessionRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
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

    // ───────────────────────────── single-use password tokens ─────────────────────────────
    //
    // Both flows that mutate a password without an access token — forgot-password confirm and the
    // forced change 13-08 adds — need the same four properties: 256 bits of entropy, only the hash
    // at rest, one redemption ever, and a deadline. They live here rather than in either flow so
    // there is one implementation of "how a password token is generated, hashed and spent". They
    // used to live privately in PasswordResetService, which is why the reset flow was the only one
    // that had them at all.

    /**
     * Mints a token for one user and one purpose, persisting only its hash.
     *
     * <p>Any outstanding token of the same purpose for that user is retired first, so a user holds
     * at most one live token per flow. Must be called inside a transaction in which the tenant GUC
     * is already set — both statements are subject to the table's row-level-security policy.
     *
     * @return the raw token, which the caller must hand to exactly one recipient and must never
     *         persist, log, or place in an event payload
     */
    public IssuedToken issueSingleUseToken(UUID tenantId, UUID userId, TokenPurpose purpose) {
        Instant now = Instant.now();
        passwordResetTokenRepository.invalidateOutstanding(userId, purpose.dbValue(), now);

        String rawToken = generateToken(tenantId);
        Instant expiresAt = now.plus(purpose.ttl());

        PasswordResetTokenEntity entity = new PasswordResetTokenEntity();
        entity.setTenantId(tenantId);
        entity.setUserId(userId);
        entity.setTokenHash(hashToken(rawToken));
        entity.setPurpose(purpose.dbValue());
        entity.setExpiresAt(expiresAt);
        passwordResetTokenRepository.saveAndFlush(entity);

        return new IssuedToken(rawToken, expiresAt);
    }

    /**
     * Spends a token, or refuses.
     *
     * <p>Three things happen here and the order is load-bearing:
     *
     * <ol>
     *   <li><b>Read the tenant out of the token's own routing prefix</b> — see
     *       {@link #generateToken}. Both redeeming flows are public, so no JWT has populated
     *       {@code TenantContext} and {@code TenantAwareDataSource} has set no GUC; and
     *       {@code password_reset_tokens} is {@code FORCE ROW LEVEL SECURITY} on that GUC, so
     *       without a tenant nothing is visible and the lookup that must find the row matches
     *       nothing. This is not theoretical: measured against the live RLS-enforcing database
     *       before this plan, the forgot-password confirm endpoint refused a token whose row was
     *       demonstrably present, unused and unexpired.</li>
     *   <li><b>Set the GUC</b>, transaction-local, so everything after this runs under the policy
     *       rather than around it. The prefix decides WHICH tenant to look in and nothing else —
     *       it grants no visibility, it narrows it.</li>
     *   <li><b>Claim the token with a conditional UPDATE</b> — see
     *       {@link PasswordResetTokenRepository#claimIfRedeemable}. Validity is not read and then
     *       acted on; it is decided by the write itself, so two concurrent redemptions of the same
     *       token cannot both succeed.</li>
     * </ol>
     *
     * <p><b>Every failure is the same failure.</b> Malformed, wrong tenant, absent, wrong purpose,
     * expired, already spent, and pointing at a row that no longer exists all raise the identical
     * exception with the purpose's constant message. A caller cannot learn which, and therefore
     * cannot learn whether an account exists.
     *
     * <p>The claim is deliberately NOT rolled back when the caller subsequently fails to
     * authenticate — see {@code PasswordChangeService.changeForcedPassword} for why that is a
     * property rather than an accident.
     *
     * @throws AuthenticationFailedException on any defect whatsoever
     */
    public RedeemedToken redeemSingleUseToken(String rawToken, TokenPurpose purpose) {
        UUID tenantId = tenantOf(rawToken, purpose);
        setTenantGuc(tenantId);

        String tokenHash = hashToken(rawToken);
        if (passwordResetTokenRepository.claimIfRedeemable(tokenHash, purpose.dbValue(), Instant.now()) != 1) {
            throw new AuthenticationFailedException(purpose.genericFailureMessage());
        }

        PasswordResetTokenEntity token = passwordResetTokenRepository
            .findByTokenHashAndPurpose(tokenHash, purpose.dbValue())
            .orElseThrow(() -> new AuthenticationFailedException(purpose.genericFailureMessage()));

        return new RedeemedToken(token.getTenantId(), token.getUserId());
    }

    private UUID tenantOf(String rawToken, TokenPurpose purpose) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new AuthenticationFailedException(purpose.genericFailureMessage());
        }
        int separator = rawToken.indexOf(TENANT_PREFIX_SEPARATOR);
        if (separator <= 0) {
            throw new AuthenticationFailedException(purpose.genericFailureMessage());
        }
        try {
            return UUID.fromString(rawToken.substring(0, separator));
        } catch (IllegalArgumentException malformed) {
            // Never rethrow the parse failure: its message quotes the submitted value, which would
            // put a credential in an error body and distinguish "malformed" from "unknown".
            throw new AuthenticationFailedException(purpose.genericFailureMessage());
        }
    }

    /**
     * {@code <tenantId>.<256 random bits, base64url>}.
     *
     * <p><b>Why the token carries a routing prefix instead of a database lookup resolving it.</b>
     * The row cannot be found without the tenant GUC, and the GUC cannot be set without knowing the
     * tenant, so something has to break the circle. The obvious move — a {@code SECURITY DEFINER}
     * function, as changeset 052 does for refresh sessions — was implemented, applied and then
     * withdrawn, because measurement showed it does not work and the precedent it copies only
     * works by accident:
     *
     * <pre>
     *   auth_lookup_refresh_tenant        owner = postgres    (rolbypassrls = true)
     *   auth_lookup_password_token_tenant owner = auth_user   (rolbypassrls = false)
     * </pre>
     *
     * SECURITY DEFINER runs a function as its OWNER, and {@code FORCE ROW LEVEL SECURITY} subjects
     * even the table's owner to the policy. 052's function bypasses RLS solely because some earlier
     * migration run created it as a superuser; Liquibase today runs as {@code auth_user}, so the
     * identical DDL produced a function that returned NULL for a row that was right there. Building
     * on that would have made this flow depend on which operating system account happened to run a
     * migration years ago — and it means the refresh path is one clean re-provision away from
     * breaking the same way, which is recorded in the plan summary rather than fixed here.
     *
     * <p><b>The prefix costs no security.</b> The tenant id is not a secret — the caller typed the
     * tenant's slug to get here. It grants nothing: the GUC only ever narrows what the policy makes
     * visible, and the stored hash is of the WHOLE token, so an attacker who edits the prefix
     * changes the hash and matches nothing, in their own tenant or anyone else's. Cross-tenant
     * redemption is therefore impossible by construction rather than by a check, and the secret
     * half is still a full 256 bits from {@link SecureRandom} — the only thing an attacker who
     * already knows a password does not have.
     */
    private String generateToken(UUID tenantId) {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return tenantId + TENANT_PREFIX_SEPARATOR
            + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * SHA-256, lowercase hex — the only form of a token that is ever written down.
     *
     * <p>Unsalted and uniterated on purpose: this is not a password. The input is 256 random bits,
     * so there is no dictionary to run and no work factor worth paying. What it buys is that a
     * database leak (or a backup, or a replica, or a support query) yields hashes rather than usable
     * tokens.
     */
    public static String hashToken(String rawToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
