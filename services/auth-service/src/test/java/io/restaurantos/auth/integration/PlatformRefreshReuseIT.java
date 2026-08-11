package io.restaurantos.auth.integration;

import io.restaurantos.auth.entity.RefreshScope;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * That a detected platform token replay actually REVOKES the session family — and survives the
 * transaction (16b-01).
 *
 * <h2>Why this exists as an integration test when the branch is already unit-tested</h2>
 *
 * <p>{@code PlatformRefreshRotationTest} asserts that reuse detection CALLS the revocation, and it
 * passed while the behaviour was broken. The revocation ran, then
 * {@code AuthenticationFailedException} — a {@code RuntimeException} — propagated out of a
 * {@code @Transactional} method and Spring rolled the whole thing back, un-revoking everything. A
 * mock cannot see that: it faithfully records a call whose effect is later undone.
 *
 * <p>Measured against the live stack before the fix: replaying a spent token returned 401
 * (correct), and its successor then still returned <b>200</b>. The alarm fired and cost the
 * attacker nothing. This test is that measurement, made permanent — it needs a real transaction and
 * a real database, so it is here rather than beside its unit test.
 *
 * <h2>What this test does NOT claim</h2>
 *
 * <p>Nothing about RLS. Testcontainers runs as SUPERUSER and bypasses row-level security entirely,
 * so the fact that these rows are visible here says nothing whatsoever about whether the sentinel
 * tenant isolates them in production. That is verified against the live database as the real
 * {@code auth_user} role and recorded in 16b-01-SUMMARY.md. This file is about transaction
 * semantics only.
 */
class PlatformRefreshReuseIT extends BaseIntegrationTest {

    @Autowired private RefreshSessionRepository refreshSessionRepository;

    /**
     * The platform user id is arbitrary here: this test never reaches the control-plane standing
     * check, because reuse is detected and refused before it.
     */
    private static final UUID PLATFORM_USER = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");

    @Test
    void replayingASpentPlatformToken_revokesTheWholeFamily_andTheRevocationSurvivesTheRollback() {
        // Two live platform sessions for one operator — the ordinary state after a rotation, and
        // the state that makes "revoke the family" mean something more than "revoke this one".
        String spent = "spent-" + UUID.randomUUID();
        String successor = "successor-" + UUID.randomUUID();
        persistPlatformSession(spent, /* alreadyRevoked */ true);
        persistPlatformSession(successor, /* alreadyRevoked */ false);

        // Present the ALREADY-SPENT token. This is what a replay looks like: the row exists and its
        // revoked_at is set, which is the only evidence that a cookie was copied.
        var replay = exchangePost("/api/v1/auth/refresh", "refresh_token=" + spent);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // THE assertion, and the one that was false before noRollbackFor. Refusing the replay is
        // not enough on its own: if the successor is still live, the holder of the copied cookie
        // simply keeps using the one that worked.
        setRls(RefreshScope.PLATFORM_TENANT_SENTINEL);
        RefreshSessionEntity successorRow =
            refreshSessionRepository.findByTokenHash(sha256Hex(successor)).orElseThrow();
        assertThat(successorRow.getRevokedAt())
            .as("a detected replay must revoke every live platform session for that user, and the "
                + "revocation must COMMIT — the refusal is a RuntimeException out of a "
                + "@Transactional method, so without noRollbackFor this write is undone")
            .isNotNull();

        // And the successor is genuinely unusable over HTTP, not merely marked in a row.
        var afterRevocation = exchangePost("/api/v1/auth/refresh", "refresh_token=" + successor);
        assertThat(afterRevocation.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    /**
     * A TENANT session is untouched by a platform replay. The revocation is scoped by user id AND
     * scope; this pins the scope half, which is the one a later "simplification" would drop.
     */
    @Test
    void aPlatformReplay_doesNotTouchTenantSessions() {
        String spent = "spent-" + UUID.randomUUID();
        persistPlatformSession(spent, true);

        String tenantToken = "tenant-" + UUID.randomUUID();
        setRls(TestFixtures.demoTenantId());
        RefreshSessionEntity tenant = new RefreshSessionEntity();
        tenant.setScope(RefreshScope.TENANT);
        tenant.setTenantId(TestFixtures.demoTenantId());
        // Deliberately the SAME id as the platform user. Platform ids come from platform_db and
        // tenant ids from `users`, so a collision is vanishingly unlikely — which is exactly why a
        // revocation that keyed on user id alone would pass every realistic test and still be wrong.
        tenant.setUserId(PLATFORM_USER);
        tenant.setTokenHash(sha256Hex(tenantToken));
        tenant.setExpiresAt(Instant.now().plusSeconds(3600));
        tenant.setCreatedAt(Instant.now());
        refreshSessionRepository.save(tenant);

        var replay = exchangePost("/api/v1/auth/refresh", "refresh_token=" + spent);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        setRls(TestFixtures.demoTenantId());
        assertThat(refreshSessionRepository.findByTokenHash(sha256Hex(tenantToken)).orElseThrow()
            .getRevokedAt())
            .as("a platform-scope revocation must never reach a tenant session")
            .isNull();
    }

    private void persistPlatformSession(String rawToken, boolean alreadyRevoked) {
        setRls(RefreshScope.PLATFORM_TENANT_SENTINEL);
        RefreshSessionEntity s = new RefreshSessionEntity();
        s.setScope(RefreshScope.PLATFORM);
        s.setTenantId(RefreshScope.PLATFORM_TENANT_SENTINEL);
        s.setUserId(PLATFORM_USER);
        s.setTokenHash(sha256Hex(rawToken));
        s.setExpiresAt(Instant.now().plusSeconds(1800));
        s.setRevokedAt(alreadyRevoked ? Instant.now() : null);
        s.setCreatedAt(Instant.now());
        refreshSessionRepository.save(s);
    }

    private static String sha256Hex(String raw) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
