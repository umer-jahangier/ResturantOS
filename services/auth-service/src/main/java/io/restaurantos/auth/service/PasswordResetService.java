package io.restaurantos.auth.service;

import io.restaurantos.auth.config.PasswordResetDeliveryProperties;
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
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
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
 * resolves the tenant from the token's own routing prefix before setting the GUC.
 *
 * <p>(This sentence used to say "through a SECURITY DEFINER function, the same thing
 * {@code RefreshSessionService} has always done". That was written, applied and then WITHDRAWN
 * within 13-08 and the javadoc was not updated with it. Corrected here because a comment that
 * describes a design the code does not have is worse than none: the function returned NULL for a
 * row that was demonstrably present, since SECURITY DEFINER runs as the OWNER and
 * {@code FORCE ROW LEVEL SECURITY} subjects even the owner to the policy — 052's precedent works
 * only because some earlier migration run created it as a superuser. See
 * {@link PasswordPolicyService} for the full account.)
 */
@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

    private final AuthTenantRepository authTenantRepository;
    private final UserRepository userRepository;
    private final PasswordPolicyService passwordPolicyService;
    private final PasswordResetDeliveryProperties deliveryProperties;
    private final TenantContext tenantContext;
    private final PasswordEncoder passwordEncoder;
    private final EventPublisher eventPublisher;

    public PasswordResetService(AuthTenantRepository authTenantRepository,
                                UserRepository userRepository,
                                PasswordPolicyService passwordPolicyService,
                                PasswordResetDeliveryProperties deliveryProperties,
                                TenantContext tenantContext,
                                PasswordEncoder passwordEncoder,
                                EventPublisher eventPublisher) {
        this.authTenantRepository = authTenantRepository;
        this.userRepository = userRepository;
        this.passwordPolicyService = passwordPolicyService;
        this.deliveryProperties = deliveryProperties;
        this.tenantContext = tenantContext;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Tells the operator at boot when self-service reset cannot deliver.
     *
     * <p>Logged here rather than in the properties record so it fires once, from a bean that is
     * unambiguously part of the flow it describes. Without it the first thing that reveals a
     * disabled reset flow is a user complaining that no email arrived — which is indistinguishable
     * from a broken mail configuration and sends the investigation somewhere else entirely.
     */
    @PostConstruct
    void warnIfDeliveryDisabled() {
        deliveryProperties.startupWarning().ifPresent(log::warn);
    }

    /**
     * What a reset request did, insofar as the caller may be told.
     *
     * <p>Two values, and NEITHER of them depends on the account. That is the type doing the work:
     * there is no {@code NO_SUCH_ACCOUNT} and no {@code COOLDOWN} to leak, so a future edit cannot
     * accidentally return one. The distinction that IS drawn is account-independent by
     * construction — whether this deployment can deliver anything at all — and therefore discloses
     * nothing about whether an address exists.
     */
    public enum RequestOutcome {
        /**
         * The request was accepted. Says nothing about whether a token was issued: an unknown
         * address, an unknown tenant, an account inside its cooldown and a successful issuance all
         * produce this, deliberately and indistinguishably.
         */
        ACCEPTED,

        /** This deployment cannot deliver a reset token to anybody. See D-31. */
        DELIVERY_DISABLED
    }

    /**
     * Requests a reset token for an address, if this deployment can deliver one and the account is
     * outside its cooldown.
     *
     * <p><b>The order of the two guards is the security property.</b> The delivery-mode check runs
     * FIRST, before any tenant is resolved and before any row is read, so the disabled response
     * cannot depend on anything account-specific — not on the body, and not on the time taken to
     * produce it. Moving it below the tenant lookup would make an unknown tenant measurably faster
     * than a known one, which is the same oracle in a slower form.
     *
     * <p>Every other branch — unknown tenant, suspended tenant, unknown address, inside the
     * cooldown, token issued — returns {@link RequestOutcome#ACCEPTED}, and the controller renders
     * one body for all of them. The audit rates this endpoint's non-enumeration property as one of
     * the few things in the password area that is well built; nothing in 13-09 trades it away, and
     * the ITs assert it by comparing response BODIES rather than statuses.
     */
    @Transactional
    public RequestOutcome request(String email, String tenantSlug) {
        if (!deliveryProperties.deliveryEnabled()) {
            return RequestOutcome.DELIVERY_DISABLED;
        }

        AuthTenantEntity tenant = authTenantRepository.findBySlug(tenantSlug)
            .filter(t -> "ACTIVE".equals(t.getStatus()))
            .orElse(null);
        if (tenant == null) {
            return RequestOutcome.ACCEPTED;
        }

        UUID tenantId = tenant.getId();
        // Before the first row-level-security-scoped read of this transaction, and therefore before
        // the user lookup AND before the cooldown read below. Both are on FORCE ROW LEVEL SECURITY
        // tables; a caller that sets this late sees nothing and fails silently open. This flow has
        // already shipped broken that way once — 13-08 found reset-confirm doing it — and the
        // integration suite stayed green throughout because Testcontainers runs as a SUPERUSER.
        passwordPolicyService.setTenantGuc(tenantId);
        tenantContext.set(tenantId, null, null, null);

        userRepository.findByEmail(email.toLowerCase())
            .ifPresent(user -> issueUnlessWithinCooldown(user, tenantId));
        return RequestOutcome.ACCEPTED;
    }

    /**
     * Issues, unless this account has already had a reset token minted inside the cooldown window.
     *
     * <p><b>Refusing SILENTLY is the point.</b> A cooldown that announces itself — a 429, a
     * "try again in 12 minutes", any observable difference at all — is an account-existence oracle
     * with a rate limiter attached: an attacker requests twice and learns from the second answer
     * whether the first one landed on a real account. So the refusal is a no-op and the caller is
     * told exactly what a successful issuance tells them (threat T-13-09-B).
     *
     * <p>The cooldown complements, and does not replace, the gateway's per-IP budget on
     * {@code auth-route} (replenishRate 2/s, burst 100). That one bounds how much traffic one
     * SOURCE can generate; this one bounds how many messages one ACCOUNT can be made to receive,
     * which is the thing a distributed caller could otherwise multiply without limit.
     */
    private void issueUnlessWithinCooldown(UserEntity user, UUID tenantId) {
        passwordPolicyService.lockForIssuance(user.getId());

        Instant threshold = Instant.now().minus(deliveryProperties.cooldown());
        boolean insideCooldown = passwordPolicyService
            .lastIssuedAt(user.getId(), TokenPurpose.RESET)
            .filter(issuedAt -> issuedAt.isAfter(threshold))
            .isPresent();
        if (insideCooldown) {
            return;
        }

        issueResetToken(user, tenantId);
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
     * {@code Docs/known-gaps/notification-delivery.md} for what such a consumer must do, and why
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
