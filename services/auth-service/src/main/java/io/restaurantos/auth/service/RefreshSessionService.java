package io.restaurantos.auth.service;

import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.entity.RefreshScope;
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
import java.util.Optional;
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
        // Stated rather than left to the field initialiser: this is the line that decides a tenant
        // login can never mint a control-plane token, and it should be readable as such.
        session.setScope(RefreshScope.TENANT);
        refreshSessionRepository.save(session);
        return rawToken;
    }

    /**
     * Open a control-plane refresh session for a verified platform user (16b-01).
     *
     * <h3>Why this is a separate method and not a {@code tenantId == null} branch in {@link #issue}</h3>
     *
     * <p>The two differ in the three things that matter — lifetime, scope, and which tenant GUC has
     * to be in force to write the row — and a single method taking a nullable tenant would make all
     * three implicit in one argument being absent. The bug that shape invites is a tenant login
     * whose tenant lookup silently returned null quietly opening a PLATFORM session. Here that
     * cannot be expressed.
     *
     * <p><b>The GUC set below is not a widening.</b> {@code refresh_sessions} is FORCE RLS and the
     * policy applies to INSERT as well as SELECT (the policy declares no separate {@code WITH
     * CHECK}, so PostgreSQL uses {@code USING} for both), which means the row cannot be written at
     * all unless {@code app.current_tenant_id} equals the value being stored. Setting it to the
     * reserved sentinel puts this statement inside a tenant namespace of exactly one that no real
     * tenant can enter — see {@link RefreshScope#PLATFORM_TENANT_SENTINEL}. It is set {@code local}
     * (the third argument to {@code set_config}), so it lasts to the end of this transaction and
     * cannot leak into a later one on the same pooled connection.
     *
     * @param ttlSeconds deliberately a parameter rather than {@code jwtProperties.getRefreshTtlSeconds()}:
     *                   the tenant TTL is 7 days and a platform session must not have it. The caller
     *                   passes the platform-specific value so that reusing the tenant number here
     *                   would have to be a typed-out decision, not an omission.
     * @return the raw token to be sent as the cookie; only its SHA-256 is stored
     */
    public String issuePlatform(UUID platformUserId, long ttlSeconds, String userAgent, String ip) {
        setTenantGuc(RefreshScope.PLATFORM_TENANT_SENTINEL);
        String rawToken = generateToken();
        RefreshSessionEntity session = new RefreshSessionEntity();
        session.setTenantId(RefreshScope.PLATFORM_TENANT_SENTINEL);
        session.setUserId(platformUserId);
        session.setTokenHash(hashToken(rawToken));
        // No branch: a control-plane session is not scoped to one, and writing one here would be
        // the first half of an accidental tenant session.
        session.setBranchId(null);
        session.setExpiresAt(Instant.now().plusSeconds(ttlSeconds));
        session.setUserAgent(userAgent);
        session.setIp(ip);
        session.setCreatedAt(Instant.now());
        session.setScope(RefreshScope.PLATFORM);
        refreshSessionRepository.save(session);
        return rawToken;
    }

    /**
     * Look a session up for redemption WITHOUT filtering out revoked ones (16b-01).
     *
     * <h3>Why {@link #validate} could not be reused</h3>
     *
     * <p>{@code validate} answers "may this token be used?", and collapses "no such token" and
     * "already spent" into the same refusal — correct for the tenant path, where a spent token is
     * simply a logged-out one. Rotation needs to tell those apart, because <b>a token that exists
     * and is already revoked is a replay</b>, and a replay is the signal that a cookie has been
     * copied. Filtering it out here would throw away the only evidence of theft the design produces.
     *
     * <p>Returns empty when the hash matches nothing at all. Expiry is deliberately NOT filtered
     * either — the caller decides, so an expired platform token is refused as expired rather than
     * misreported as a replay.
     */
    public Optional<RefreshSessionEntity> findForRedemption(String rawToken) {
        String hash = hashToken(rawToken);
        bootstrapTenantGuc(hash);
        return refreshSessionRepository.findByTokenHash(hash);
    }

    /**
     * Atomically spend a token. See
     * {@link RefreshSessionRepository#claimForRotation} for why this is one statement.
     *
     * @return true if this call spent a live token; false if it had already been spent (a replay)
     */
    public boolean claimForRotation(String rawToken) {
        return refreshSessionRepository.claimForRotation(hashToken(rawToken), Instant.now()) == 1;
    }

    /**
     * Revoke every live session the user holds in {@code scope} — the response to a detected replay.
     *
     * <p>This is what makes a 30-minute platform TTL a real bound rather than a cosmetic one. A
     * stolen cookie and the genuine operator cannot both keep rotating: the second redemption of
     * the same token refuses AND takes down the whole family, so the theft costs the attacker the
     * session and tells the victim (their next action 401s and they must sign in again) instead of
     * running quietly alongside them.
     *
     * @return how many sessions were revoked
     */
    public int revokeAllLiveSessions(UUID userId, String scope) {
        return refreshSessionRepository.revokeAllLiveByUserAndScope(userId, scope, Instant.now());
    }

    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
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
