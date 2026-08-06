package io.restaurantos.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.exception.InvalidPlatformRoleException;
import io.restaurantos.shared.security.JwtClaims;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The shape of a platform access token (audit B1, cause 3 — a platform user is by definition
 * tenant-less, and {@code signAccessToken} dereferences {@code tenantId()} unguarded, so it
 * cannot mint one).
 *
 * <p>The single most load-bearing assertion here is
 * {@link #platformToken_hasNoTenantOrBranchClaimKeys()}: the tenant and branch keys must be
 * ABSENT from the payload, not present-and-null. {@code JwtGlobalFilter.parseUuid} and
 * {@code JwtAuthenticationFilter} both read those keys, and a null-valued key is one more state
 * every reader has to get right for no benefit.
 */
class PlatformTokenServiceTest {

    private static KeyPair keyPair;
    private PlatformTokenService platformTokenService;

    @BeforeAll
    static void generateKeys() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();
    }

    @BeforeEach
    void setUp() {
        AuthJwtProperties properties = new AuthJwtProperties();
        properties.setPublicKeyId("unit-test-key");
        properties.setAccessTtlSeconds(3600); // deliberately NOT 900 — the platform TTL is separate
        JwtSigningService signingService =
                new JwtSigningService((RSAPrivateKey) keyPair.getPrivate(), properties);
        platformTokenService = new PlatformTokenService(signingService, 900);
    }

    // ── Behaviour 1: parseable RS256 token whose sub is the platform user id ─────────────────

    @Test
    void platformToken_isParseableRs256WithPlatformUserAsSubject() {
        UUID platformUserId = UUID.randomUUID();

        var result = platformTokenService.mint(platformUserId, "SUPER_ADMIN");

        Claims claims = parse(result.token());
        assertThat(claims.getSubject()).isEqualTo(platformUserId.toString());
    }

    // ── Behaviour 2: tenant_id / branch_id keys are ABSENT, not null-valued ──────────────────

    @Test
    void platformToken_hasNoTenantOrBranchClaimKeys() {
        var result = platformTokenService.mint(UUID.randomUUID(), "SUPER_ADMIN");

        Map<String, Object> payload = parse(result.token());
        assertThat(payload)
                .as("an absent key is one state; a null-valued key is a second state every reader "
                        + "would have to handle")
                .doesNotContainKey("tenant_id")
                .doesNotContainKey("branch_id");
    }

    // ── Behaviour 3: roles, permissions and token_type ───────────────────────────────────────

    @Test
    void platformToken_carriesRoleInBothRolesAndPermissions() {
        var result = platformTokenService.mint(UUID.randomUUID(), "SUPER_ADMIN");

        Claims claims = parse(result.token());
        assertThat(claims.get("roles", List.class)).containsExactly("SUPER_ADMIN");
        assertThat(claims.get("permissions", List.class)).containsExactly("SUPER_ADMIN");
        assertThat(claims.get("token_type", String.class)).isEqualTo("platform");
    }

    // ── Behaviour 4: platform TTL is independent of the tenant access TTL ────────────────────

    @Test
    void platformToken_expiryUsesPlatformTtlNotAccessTtl() {
        var result = platformTokenService.mint(UUID.randomUUID(), "SUPER_ADMIN");

        Claims claims = parse(result.token());
        long lifetimeSeconds =
                (claims.getExpiration().getTime() - claims.getIssuedAt().getTime()) / 1000;
        assertThat(lifetimeSeconds).isEqualTo(900);
        assertThat(result.expiresIn()).isEqualTo(900);
    }

    /** The configured value is honoured, so the default is a default and not a hardcode. */
    @Test
    void platformToken_honoursConfiguredTtl() {
        AuthJwtProperties properties = new AuthJwtProperties();
        properties.setPublicKeyId("unit-test-key");
        var service = new PlatformTokenService(
                new JwtSigningService((RSAPrivateKey) keyPair.getPrivate(), properties), 120);

        var result = service.mint(UUID.randomUUID(), "SUPER_ADMIN");

        Claims claims = parse(result.token());
        assertThat((claims.getExpiration().getTime() - claims.getIssuedAt().getTime()) / 1000)
                .isEqualTo(120);
    }

    // ── Behaviour 6: an unrecognised role is rejected BEFORE any signing occurs ──────────────

    @Test
    void unknownPlatformRole_isRejected() {
        assertThatThrownBy(() -> platformTokenService.mint(UUID.randomUUID(), "SUPER_DUPER_ADMIN"))
                .isInstanceOf(InvalidPlatformRoleException.class)
                .hasMessageContaining("SUPER_DUPER_ADMIN");
    }

    @Test
    void nullPlatformRole_isRejected() {
        assertThatThrownBy(() -> platformTokenService.mint(UUID.randomUUID(), null))
                .isInstanceOf(InvalidPlatformRoleException.class);
    }

    /**
     * The three values {@code chk_platform_users_role} permits
     * (010-create-platform-tables.xml:108-109). Nothing else may be minted, because nothing else
     * can exist as a platform user.
     */
    @Test
    void allThreePlatformRolesAreMintable() {
        for (String role : List.of("SUPER_ADMIN", "SUPPORT", "BILLING")) {
            var result = platformTokenService.mint(UUID.randomUUID(), role);
            assertThat(parse(result.token()).get("roles", List.class)).containsExactly(role);
        }
    }

    // ── Regression guard: the tenant signer must be untouched by this work ───────────────────

    /**
     * {@code signAccessToken} still emits tenant and branch claims and still honours the
     * step-up-derived {@code totp_verified}. The platform path is additive; it may not
     * quietly change what a tenant login receives.
     */
    @Test
    void tenantAccessTokenSigningIsUnchanged() {
        AuthJwtProperties properties = new AuthJwtProperties();
        properties.setPublicKeyId("unit-test-key");
        properties.setAccessTtlSeconds(3600);
        var signingService = new JwtSigningService((RSAPrivateKey) keyPair.getPrivate(), properties);

        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = signingService.signAccessToken(new JwtClaims(
                userId, tenantId, branchId, List.of("CASHIER"), List.of("pos.order.create"),
                Map.of(), null, true));

        Claims claims = parse(token);
        assertThat(claims.get("tenant_id", String.class)).isEqualTo(tenantId.toString());
        assertThat(claims.get("branch_id", String.class)).isEqualTo(branchId.toString());
        assertThat(claims.get("totp_verified", Boolean.class)).isTrue();
        assertThat((claims.getExpiration().getTime() - claims.getIssuedAt().getTime()) / 1000)
                .isEqualTo(3600);
    }

    private Claims parse(String token) {
        return Jwts.parser()
                .verifyWith((RSAPublicKey) keyPair.getPublic())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
