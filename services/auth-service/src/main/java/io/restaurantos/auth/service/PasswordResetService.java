package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.AuthTenantEntity;
import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.PasswordResetTokenEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.exception.PasswordReuseException;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.auth.repository.PasswordResetTokenRepository;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
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

@Service
public class PasswordResetService {

    private static final String EXCHANGE = "auth.topic";
    private static final long TOKEN_TTL_SECONDS = 30 * 60L;

    private final AuthTenantRepository authTenantRepository;
    private final UserRepository userRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordHistoryRepository passwordHistoryRepository;
    private final RefreshSessionRepository refreshSessionRepository;
    private final EntityManager entityManager;
    private final TenantContext tenantContext;
    private final PasswordEncoder passwordEncoder;
    private final EventPublisher eventPublisher;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(AuthTenantRepository authTenantRepository,
                                UserRepository userRepository,
                                PasswordResetTokenRepository passwordResetTokenRepository,
                                PasswordHistoryRepository passwordHistoryRepository,
                                RefreshSessionRepository refreshSessionRepository,
                                EntityManager entityManager,
                                TenantContext tenantContext,
                                PasswordEncoder passwordEncoder,
                                EventPublisher eventPublisher) {
        this.authTenantRepository = authTenantRepository;
        this.userRepository = userRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.passwordHistoryRepository = passwordHistoryRepository;
        this.refreshSessionRepository = refreshSessionRepository;
        this.entityManager = entityManager;
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
        setTenantGuc(tenantId);
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

        setTenantGuc(resetToken.getTenantId());
        tenantContext.set(resetToken.getTenantId(), null, resetToken.getUserId(), null);

        UserEntity user = userRepository.findById(resetToken.getUserId())
            .orElseThrow(() -> new AuthenticationFailedException("Invalid or expired reset token"));

        rejectIfPasswordReused(user, newPassword);

        PasswordHistoryEntity history = new PasswordHistoryEntity();
        history.setTenantId(user.getTenantId());
        history.setUserId(user.getId());
        history.setPasswordHash(user.getPasswordHash());
        passwordHistoryRepository.save(history);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        resetToken.setUsedAt(Instant.now());
        passwordResetTokenRepository.save(resetToken);

        revokeActiveRefreshSessions(user.getId());
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

    private void rejectIfPasswordReused(UserEntity user, String newPassword) {
        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) {
            throw new PasswordReuseException("Cannot reuse a recent password");
        }
        for (PasswordHistoryEntity history : passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(user.getId())) {
            if (passwordEncoder.matches(newPassword, history.getPasswordHash())) {
                throw new PasswordReuseException("Cannot reuse a recent password");
            }
        }
    }

    private void revokeActiveRefreshSessions(UUID userId) {
        refreshSessionRepository.findByUserIdAndRevokedAtIsNull(userId).forEach(session -> {
            session.setRevokedAt(Instant.now());
            refreshSessionRepository.save(session);
        });
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
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
