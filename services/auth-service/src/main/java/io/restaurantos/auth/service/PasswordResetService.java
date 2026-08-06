package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.AuthTenantEntity;
import io.restaurantos.auth.entity.PasswordResetTokenEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.repository.PasswordResetTokenRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

/**
 * Forgot-password: issue a single-use token, then redeem it for a new password.
 *
 * <p>The reuse rule, the history append, the session revocation and the tenant GUC used to live
 * here as private methods, which made this the only flow in the platform that obeyed any of them.
 * They now live in {@link PasswordPolicyService} and this class holds no copy — see that class for
 * why that matters. What remains here is what is genuinely reset-specific: the token's lifecycle.
 */
@Service
public class PasswordResetService {

    private static final String EXCHANGE = "auth.topic";
    private static final long TOKEN_TTL_SECONDS = 30 * 60L;

    private final AuthTenantRepository authTenantRepository;
    private final UserRepository userRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordPolicyService passwordPolicyService;
    private final TenantContext tenantContext;
    private final PasswordEncoder passwordEncoder;
    private final EventPublisher eventPublisher;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(AuthTenantRepository authTenantRepository,
                                UserRepository userRepository,
                                PasswordResetTokenRepository passwordResetTokenRepository,
                                PasswordPolicyService passwordPolicyService,
                                TenantContext tenantContext,
                                PasswordEncoder passwordEncoder,
                                EventPublisher eventPublisher) {
        this.authTenantRepository = authTenantRepository;
        this.userRepository = userRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
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

    @Transactional
    public void confirm(String token, String newPassword) {
        String tokenHash = hashToken(token);
        PasswordResetTokenEntity resetToken = passwordResetTokenRepository.findByTokenHash(tokenHash)
            .filter(t -> t.getUsedAt() == null)
            .filter(t -> t.getExpiresAt().isAfter(Instant.now()))
            .orElseThrow(() -> new AuthenticationFailedException("Invalid or expired reset token"));

        passwordPolicyService.setTenantGuc(resetToken.getTenantId());
        tenantContext.set(resetToken.getTenantId(), null, resetToken.getUserId(), null);

        UserEntity user = userRepository.findById(resetToken.getUserId())
            .orElseThrow(() -> new AuthenticationFailedException("Invalid or expired reset token"));

        passwordPolicyService.rejectIfPasswordReused(user, newPassword);
        passwordPolicyService.appendCurrentPasswordToHistory(user);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        resetToken.setUsedAt(Instant.now());
        passwordResetTokenRepository.save(resetToken);

        passwordPolicyService.revokeActiveRefreshSessions(user.getId());
    }

    private void issueResetToken(UserEntity user, UUID tenantId) {
        String rawToken = generateToken();
        PasswordResetTokenEntity entity = new PasswordResetTokenEntity();
        entity.setTenantId(tenantId);
        entity.setUserId(user.getId());
        entity.setTokenHash(hashToken(rawToken));
        entity.setExpiresAt(Instant.now().plusSeconds(TOKEN_TTL_SECONDS));
        passwordResetTokenRepository.save(entity);

        eventPublisher.publish(
            EXCHANGE,
            "auth.user.password_reset_requested",
            "PASSWORD_RESET_REQUESTED",
            null,
            Map.of("userId", user.getId(), "email", user.getEmail(), "token", rawToken));
    }

    private String generateToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hashToken(String rawToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
