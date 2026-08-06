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
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
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

    private static final String EXCHANGE = "auth.topic";

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
        userRepository.save(user);

        passwordPolicyService.revokeActiveRefreshSessions(user.getId());
    }

    private void issueResetToken(UserEntity user, UUID tenantId) {
        IssuedToken issued =
            passwordPolicyService.issueSingleUseToken(tenantId, user.getId(), TokenPurpose.RESET);

        // KNOWN DEFECT, NOT INTRODUCED HERE AND NOT THIS PLAN'S TO FIX: the raw token goes into the
        // outbox payload in plaintext, alongside nothing that needs it (notification-service has no
        // source files, so nothing consumes this event at all today). The audit flags it and
        // 13-CONTEXT assigns the remedy — emit {userId, email} plus a short-lived handle, or have
        // the consumer fetch over an internal channel — to the reset hardening in 13-09. Left
        // exactly as it was rather than half-changed, so 13-09 finds the defect it was told about.
        // The FORCED_CHANGE purpose deliberately emits no event carrying its token.
        eventPublisher.publish(
            EXCHANGE,
            "auth.user.password_reset_requested",
            "PASSWORD_RESET_REQUESTED",
            null,
            Map.of("userId", user.getId(), "email", user.getEmail(), "token", issued.rawToken()));
    }
}
