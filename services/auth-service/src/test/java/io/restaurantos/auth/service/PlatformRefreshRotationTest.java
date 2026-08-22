package io.restaurantos.auth.service;

import io.restaurantos.auth.client.PlatformCredentialClient;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.auth.entity.RefreshScope;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The one invariant 16b-01 must not get wrong: <b>a platform refresh token may mint only a platform
 * token, and a tenant refresh token may mint only a tenant token.</b> Asserted in BOTH directions,
 * because "the platform case works" and "the tenant case still works" are different claims and only
 * the pair of them is the guarantee.
 *
 * <h2>Why this is a unit test and not an IT</h2>
 *
 * <p>Deliberate, and worth stating because the reflex is the opposite. The behaviour under test is a
 * BRANCH — which of two token-minting paths a session takes — and the honest way to assert "the
 * tenant minter was never called" is to hold the minter and ask it. An integration test can only
 * inspect the token that came out, so it proves the branch was taken correctly on the inputs it
 * happened to use, and says nothing about whether the other path was also entered.
 *
 * <p>There is a second reason, and it is the one that matters more. The project's own guidance is
 * that <b>Testcontainers runs as SUPERUSER and bypasses RLS entirely, so a green IT proves nothing
 * about scoping.</b> The RLS half of this design — that a platform session is invisible from a
 * tenant context and vice versa — therefore cannot be proved in an IT at all, and pretending
 * otherwise would be worse than not trying. It is measured against the live database as the real
 * {@code auth_user} role, and recorded in 16b-01-SUMMARY.md.
 */
class PlatformRefreshRotationTest {

    private static final UUID PLATFORM_USER = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");
    private static final UUID TENANT_USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID REAL_TENANT = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final String RAW_TOKEN = "a-raw-refresh-token";

    private RefreshSessionService refreshSessionService;
    private PlatformTokenService platformTokenService;
    private PlatformCredentialClient platformCredentialClient;
    private PermissionResolver permissionResolver;
    private JwtSigningService jwtSigningService;
    private AuthServiceImpl authService;

    @BeforeEach
    void setUp() {
        refreshSessionService = mock(RefreshSessionService.class);
        platformTokenService = mock(PlatformTokenService.class);
        platformCredentialClient = mock(PlatformCredentialClient.class);
        permissionResolver = mock(PermissionResolver.class);
        jwtSigningService = mock(JwtSigningService.class);

        // set_config('app.current_tenant_id', …) is a native query on the real path; here it only
        // has to not explode.
        EntityManager entityManager = mock(EntityManager.class);
        Query noop = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(noop);
        when(noop.setParameter(anyString(), any())).thenReturn(noop);
        when(noop.getSingleResult()).thenReturn(REAL_TENANT.toString());

        authService = new AuthServiceImpl(
            mock(AuthTenantRepository.class),
            mock(UserRepository.class),
            entityManager,
            mock(TenantContext.class),
            mock(PasswordEncoder.class),
            permissionResolver,
            jwtSigningService,
            refreshSessionService,
            mock(LoginEventPublisher.class),
            new AuthJwtProperties(),
            mock(TotpService.class),
            mock(RecoveryCodeService.class),
            mock(PasswordPolicyService.class),
            mock(LoginIdentityResolver.class),
            platformTokenService,
            platformCredentialClient,
            true,
            1800L);
    }

    // ── Direction 1: a platform refresh token mints a PLATFORM token and nothing else ──────────

    @Test
    void platformRefresh_mintsPlatformTokenAndNeverATenantOne() {
        givenSession(platformSession(Instant.now().plusSeconds(600)));
        when(refreshSessionService.claimForRotation(RAW_TOKEN)).thenReturn(true);
        when(platformCredentialClient.standing(PLATFORM_USER))
            .thenReturn(new PlatformCredentialClient.Standing(true, "SUPER_ADMIN"));
        when(platformTokenService.mint(PLATFORM_USER, "SUPER_ADMIN"))
            .thenReturn(new PlatformTokenService.PlatformTokenResult("platform.jwt", 900, "platform"));
        when(refreshSessionService.issuePlatform(eq(PLATFORM_USER), anyLong(), any(), any()))
            .thenReturn("successor-token");

        AuthService.RefreshResult result = authService.refresh(RAW_TOKEN);

        assertThat(result.body().accessToken()).isEqualTo("platform.jwt");
        // THE assertion. The tenant minter is the thing that must not have run: it is what would
        // turn a control-plane credential into a token carrying a tenant's roles and permissions.
        verify(jwtSigningService, never()).signAccessToken(any());
        verify(permissionResolver, never()).resolve(any(), any());
    }

    @Test
    void platformRefresh_rotatesTheCookieWithThePlatformTtl() {
        givenSession(platformSession(Instant.now().plusSeconds(600)));
        when(refreshSessionService.claimForRotation(RAW_TOKEN)).thenReturn(true);
        when(platformCredentialClient.standing(PLATFORM_USER))
            .thenReturn(new PlatformCredentialClient.Standing(true, "SUPER_ADMIN"));
        when(platformTokenService.mint(any(), anyString()))
            .thenReturn(new PlatformTokenService.PlatformTokenResult("platform.jwt", 900, "platform"));
        when(refreshSessionService.issuePlatform(eq(PLATFORM_USER), anyLong(), any(), any()))
            .thenReturn("successor-token");

        AuthService.RefreshResult result = authService.refresh(RAW_TOKEN);

        assertThat(result.rotated()).isTrue();
        assertThat(result.rotatedRefreshToken()).isEqualTo("successor-token");
        // 1800, not the 604800 the tenant path uses. A cookie outliving its session row would
        // surface only as an inexplicable 401 days later.
        assertThat(result.rotatedTtlSeconds()).isEqualTo(1800L);
        verify(refreshSessionService).issuePlatform(eq(PLATFORM_USER), eq(1800L), any(), any());
    }

    // ── Direction 2: a tenant refresh token never reaches the platform minter ──────────────────

    @Test
    void tenantRefresh_neverMintsAPlatformTokenAndDoesNotRotate() {
        RefreshSessionEntity tenant = tenantSession();
        givenSession(tenant);
        when(refreshSessionService.validate(RAW_TOKEN)).thenReturn(tenant);
        when(permissionResolver.resolve(TENANT_USER, null))
            .thenReturn(new ResolvedBranchAuth(
                null, java.util.List.of("CASHIER"), java.util.List.of("pos.order.create"),
                java.util.Map.of()));
        when(jwtSigningService.signAccessToken(any())).thenReturn("tenant.jwt");

        AuthService.RefreshResult result = authService.refresh(RAW_TOKEN);

        assertThat(result.body().accessToken()).isEqualTo("tenant.jwt");
        // The mirror image of the assertion above, and the half that is easy to forget.
        verify(platformTokenService, never()).mint(any(), anyString());
        verify(platformCredentialClient, never()).standing(any());
        // The tenant cookie is untouched by a refresh, exactly as before 16b-01. If this ever
        // becomes true, every tenant browser starts receiving a Set-Cookie it did not before.
        assertThat(result.rotated()).isFalse();
        verify(refreshSessionService, never()).claimForRotation(anyString());
    }

    // ── Single-use rotation: a replay is refused AND takes the family down ─────────────────────

    @Test
    void replayedPlatformToken_isRefusedAndRevokesEveryLivePlatformSession() {
        givenSession(platformSession(Instant.now().plusSeconds(600)));
        // Already spent: the conditional UPDATE matched no live row.
        when(refreshSessionService.claimForRotation(RAW_TOKEN)).thenReturn(false);
        when(refreshSessionService.revokeAllLiveSessions(PLATFORM_USER, RefreshScope.PLATFORM))
            .thenReturn(2);

        assertThatThrownBy(() -> authService.refresh(RAW_TOKEN))
            .isInstanceOf(AuthenticationFailedException.class);

        // Refusing alone would leave the thief and the operator both still holding live successors.
        // Revoking the family is what converts a detected replay into an ended session.
        verify(refreshSessionService).revokeAllLiveSessions(PLATFORM_USER, RefreshScope.PLATFORM);
        verify(platformTokenService, never()).mint(any(), anyString());
    }

    @Test
    void expiredPlatformToken_isRefusedWithoutRaisingTheReuseAlarm() {
        givenSession(platformSession(Instant.now().minusSeconds(1)));

        assertThatThrownBy(() -> authService.refresh(RAW_TOKEN))
            .isInstanceOf(AuthenticationFailedException.class);

        // An idle session timing out is not a compromise. If expiry tripped the family revocation,
        // the alarm in the logs would fire for every SuperAdmin who went to lunch, and would stop
        // meaning anything on the day it mattered.
        verify(refreshSessionService, never()).revokeAllLiveSessions(any(), anyString());
        verify(refreshSessionService, never()).claimForRotation(anyString());
    }

    // ── The control plane still gets to end a session ──────────────────────────────────────────

    @Test
    void deactivatedPlatformUser_cannotRotate() {
        givenSession(platformSession(Instant.now().plusSeconds(600)));
        when(refreshSessionService.claimForRotation(RAW_TOKEN)).thenReturn(true);
        when(platformCredentialClient.standing(PLATFORM_USER))
            .thenReturn(PlatformCredentialClient.Standing.NOT_RENEWABLE);

        assertThatThrownBy(() -> authService.refresh(RAW_TOKEN))
            .isInstanceOf(AuthenticationFailedException.class);

        // Without this, rotation would be a way to outlive deactivation indefinitely — the one way
        // this phase could have made security worse than the 15-minute token it replaced.
        verify(platformTokenService, never()).mint(any(), anyString());
        verify(refreshSessionService).revokeAllLiveSessions(PLATFORM_USER, RefreshScope.PLATFORM);
    }

    @Test
    void unknownRefreshToken_isRefusedBeforeAnythingIsMinted() {
        when(refreshSessionService.findForRedemption(RAW_TOKEN)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.refresh(RAW_TOKEN))
            .isInstanceOf(AuthenticationFailedException.class);

        verify(platformTokenService, never()).mint(any(), anyString());
        verify(jwtSigningService, never()).signAccessToken(any());
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────

    private void givenSession(RefreshSessionEntity session) {
        when(refreshSessionService.findForRedemption(RAW_TOKEN)).thenReturn(Optional.of(session));
    }

    private RefreshSessionEntity platformSession(Instant expiresAt) {
        RefreshSessionEntity s = new RefreshSessionEntity();
        s.setScope(RefreshScope.PLATFORM);
        s.setTenantId(RefreshScope.PLATFORM_TENANT_SENTINEL);
        s.setUserId(PLATFORM_USER);
        s.setExpiresAt(expiresAt);
        s.setCreatedAt(Instant.now());
        return s;
    }

    private RefreshSessionEntity tenantSession() {
        RefreshSessionEntity s = new RefreshSessionEntity();
        s.setScope(RefreshScope.TENANT);
        s.setTenantId(REAL_TENANT);
        s.setUserId(TENANT_USER);
        s.setExpiresAt(Instant.now().plusSeconds(600));
        s.setCreatedAt(Instant.now());
        return s;
    }
}
