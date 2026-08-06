package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.AuthTenantEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.auth.service.PasswordPolicyService.IssuedToken;
import io.restaurantos.auth.service.PasswordPolicyService.RedeemedToken;
import io.restaurantos.auth.service.PasswordPolicyService.TokenPurpose;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.payload.PasswordResetRequestedPayload;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Forgot-password: issue a single-use token, then redeem it for a new password.
 *
 * <p>The reuse rule, the history append, the session revocation, the tenant GUC and — since 13-08 —
 * the token's own lifecycle used to live here as private methods, which made this the only flow in
 * the platform that obeyed any of them. They now live in {@link PasswordPolicyService} and this
 * class holds no copy. What remains here is what is genuinely reset-specific: which account a
 * request is for, and what gets published when one is made.
 *
 * <p><b>13-08 fixed a defect in this class that no test could have caught.</b> {@code confirm}
 * looked the token up by hash <i>before</i> establishing the tenant GUC. {@code
 * password_reset_tokens} is {@code FORCE ROW LEVEL SECURITY} on that GUC, so the lookup matched
 * nothing and every forgot-password confirmation was refused as "invalid or expired" — measured
 * against the live database on a token that was demonstrably present, unused and unexpired. It
 * passed in CI because Testcontainers' Postgres user is a SUPERUSER and superusers bypass row
 * security. Redemption now goes through {@link PasswordPolicyService#redeemSingleUseToken}, which
 * resolves the tenant through a SECURITY DEFINER function first — the same thing
 * {@code RefreshSessionService} has always done for refresh tokens.
 */
@Service
public class PasswordResetService {

    private final AuthTenantRepository authTenantRepository;
    private final UserRepository userRepository;
    private final PasswordPolicyService passwordPolicyService;
    private final TenantContext tenantContext;
    private final PasswordEncoder passwordEncoder;
    private final EventPublisher eventPublisher;

    public PasswordResetService(AuthTenantRepository authTenantRepository,
                                UserRepository userRepository,
                                PasswordPolicyService passwordPolicyService,
                                TenantContext tenantContext,
                                PasswordEncoder passwordEncoder,
                                EventPublisher eventPublisher) {
        this.authTenantRepository = authTenantRepository;
        this.userRepository = userRepository;
        this.passwordPolicyService = passwordPolicyService;
        this.tenantContext = tenantContext;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public void request(String email, String tenantSlug) {
        AuthTenantEntity tenant = authTenantRepository.findBySlug(tenantSlug)
            .filter(t -> "ACTIVE".equals(t.getStatus()))
            .orElse(null);
        if (tenant == null) {
            return;
        }

        UUID tenantId = tenant.getId();
        passwordPolicyService.setTenantGuc(tenantId);
        tenantContext.set(tenantId, null, null, null);

        userRepository.findByEmail(email.toLowerCase()).ifPresent(user -> issueResetToken(user, tenantId));
    }

    /**
     * Redeems a RESET token. A FORCED_CHANGE token presented here is refused exactly as a fabricated
     * one is — the purpose is matched together with the hash, in the same statement.
     */
    @Transactional
    public void confirm(String token, String newPassword) {
        RedeemedToken redeemed = passwordPolicyService.redeemSingleUseToken(token, TokenPurpose.RESET);
        tenantContext.set(redeemed.tenantId(), null, redeemed.userId(), null);

        UserEntity user = userRepository.findById(redeemed.userId())
            .orElseThrow(() -> new AuthenticationFailedException(
                TokenPurpose.RESET.genericFailureMessage()));

        passwordPolicyService.rejectIfPasswordReused(user, newPassword);
        passwordPolicyService.appendCurrentPasswordToHistory(user);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        // D-18. Without this a user who resets is STILL locked out, having already done the only
        // thing the error told them to do — and the reset appears to have silently failed. The
        // clearing is delegated to the shared routine 13-04 extracted rather than reimplemented
        // here: "reset clears the lockout but change does not" (or the reverse) is exactly the
        // two-paths-that-drift shape this phase's audit is about.
        passwordPolicyService.clearLockout(user);
        // Same reasoning applied to the forced-change flag (13-08, D-17). The flag exists to stop a
        // temporary credential from becoming a permanent one; a password the user has just chosen
        // themselves, on the strength of a token delivered to their own address, is not a temporary
        // credential. Leaving it set would refuse the very next login with PASSWORD_CHANGE_REQUIRED
        // and demand a SECOND change of a password chosen seconds earlier — which reads as a broken
        // reset, and is the same divergence PasswordChangeService.changeOwnPassword already avoids
        // by clearing it. The gate is not weakened: nothing here bypasses it for a password the
        // user did not choose.
        user.setMustChangePassword(false);
        userRepository.save(user);

        passwordPolicyService.revokeActiveRefreshSessions(user.getId());
    }

    /**
     * Mints a token and announces that one was minted — without announcing the token.
     *
     * <p><b>The defect this replaces (D-19, ROADMAP SC4).</b> The published payload used to be
     * {@code {userId, email, token}} with {@code token} the RAW value, written into
     * {@code event_outbox} beside auth-service's own SHA-256 of the same string. That made the
     * hashing decorative: the credential was durable, replicated to every consumer of
     * {@code auth.topic}, and present in every backup, so read access to any of those was account
     * takeover for anyone who had ever requested a reset — without touching
     * {@code password_reset_tokens} at all.
     *
     * <p>What goes out instead is the identity a delivery consumer needs to address a message, plus
     * {@code tokenId} — the handle of the row holding the hash. A consumer that needs the token
     * fetches it over an internal channel keyed on that handle; it is never pushed one. See
     * {@code docs/known-gaps/notification-delivery.md} for what such a consumer must do, and why
     * this milestone deliberately ships without one rather than with a stub that accepts a message
     * and discards it.
     */
    private void issueResetToken(UserEntity user, UUID tenantId) {
        IssuedToken issued =
            passwordPolicyService.issueSingleUseToken(tenantId, user.getId(), TokenPurpose.RESET);

        eventPublisher.publish(
            PasswordResetRequestedPayload.EXCHANGE,
            PasswordResetRequestedPayload.ROUTING_KEY,
            PasswordResetRequestedPayload.EVENT_TYPE,
            null,
            new PasswordResetRequestedPayload(user.getId(), user.getEmail(), issued.tokenId()));
    }
}
