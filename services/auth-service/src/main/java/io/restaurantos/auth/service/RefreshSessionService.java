package io.restaurantos.auth.service;

import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class RefreshSessionService {

    private final RefreshSessionRepository refreshSessionRepository;
    private final AuthJwtProperties jwtProperties;
    private final EntityManager entityManager;
    private final SecureRandom secureRandom = new SecureRandom();

    public RefreshSessionService(RefreshSessionRepository refreshSessionRepository,
                                 AuthJwtProperties jwtProperties,
                                 EntityManager entityManager) {
        this.refreshSessionRepository = refreshSessionRepository;
        this.jwtProperties = jwtProperties;
        this.entityManager = entityManager;
    }

    public String issue(UUID userId, UUID tenantId, UUID branchId, String userAgent, String ip) {
        String rawToken = generateToken();
        RefreshSessionEntity session = new RefreshSessionEntity();
        session.setTenantId(tenantId);
        session.setUserId(userId);
        session.setTokenHash(hashToken(rawToken));
        session.setBranchId(branchId);
        session.setExpiresAt(Instant.now().plusSeconds(jwtProperties.getRefreshTtlSeconds()));
        session.setUserAgent(userAgent);
        session.setIp(ip);
        session.setCreatedAt(Instant.now());
        refreshSessionRepository.save(session);
        return rawToken;
    }

    public RefreshSessionEntity validate(String rawToken) {
        String hash = hashToken(rawToken);
        bootstrapTenantGuc(hash);
        return refreshSessionRepository.findByTokenHash(hash)
            .filter(s -> s.getRevokedAt() == null)
            .filter(s -> s.getExpiresAt().isAfter(Instant.now()))
            .orElseThrow(() -> new AuthenticationFailedException("Invalid refresh session"));
    }

    public void revoke(String rawToken) {
        String hash = hashToken(rawToken);
        bootstrapTenantGuc(hash);
        refreshSessionRepository.findByTokenHash(hash).ifPresent(session -> {
            session.setRevokedAt(Instant.now());
            refreshSessionRepository.save(session);
        });
    }

    private void bootstrapTenantGuc(String tokenHash) {
        Object tenantId = entityManager.createNativeQuery(
                "SELECT auth_lookup_refresh_tenant(:hash)")
            .setParameter("hash", tokenHash)
            .getSingleResult();
        if (tenantId == null) {
            throw new AuthenticationFailedException("Invalid refresh session");
        }
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
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

    private String generateToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
