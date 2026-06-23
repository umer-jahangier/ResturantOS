package io.restaurantos.auth.service;

import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.repository.RefreshSessionRepository;
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
    private final SecureRandom secureRandom = new SecureRandom();

    public RefreshSessionService(RefreshSessionRepository refreshSessionRepository,
                                 AuthJwtProperties jwtProperties) {
        this.refreshSessionRepository = refreshSessionRepository;
        this.jwtProperties = jwtProperties;
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
        return refreshSessionRepository.findByTokenHash(hashToken(rawToken))
            .filter(s -> s.getRevokedAt() == null)
            .filter(s -> s.getExpiresAt().isAfter(Instant.now()))
            .orElseThrow(() -> new io.restaurantos.auth.exception.AuthenticationFailedException("Invalid refresh session"));
    }

    public void revoke(String rawToken) {
        refreshSessionRepository.findByTokenHash(hashToken(rawToken)).ifPresent(session -> {
            session.setRevokedAt(Instant.now());
            refreshSessionRepository.save(session);
        });
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
