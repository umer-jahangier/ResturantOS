package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins the proof-of-possession guard on {@code /2fa/setup}.
 *
 * <p>An adversarial review found this method took no argument and checked nothing, which made the
 * {@code \d{6}} rule on {@code /2fa/recovery-codes} decorative: redeem a recovery code at login,
 * call setup with no code, verify against an authenticator you control, and the regeneration you
 * were supposedly barred from happens anyway. These tests exist so that door cannot reopen quietly.
 */
class TwoFactorSetupGuardTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID TENANT = UUID.randomUUID();
    private static final String LIVE_SECRET = "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R";

    private UserRepository userRepository;
    private TotpService totpService;
    private RecoveryCodeService recoveryCodeService;
    private TwoFactorService service;
    private UserEntity user;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        totpService = mock(TotpService.class);
        recoveryCodeService = mock(RecoveryCodeService.class);
        TenantContext tenantContext = mock(TenantContext.class);
        when(tenantContext.requireTenantId()).thenReturn(TENANT);

        // loadCurrentUser() sets the tenant GUC through a native query before it touches the
        // repository, so the EntityManager has to answer or every test NPEs before reaching the
        // guard it is meant to exercise.
        EntityManager entityManager = mock(EntityManager.class);
        Query gucQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(gucQuery);
        when(gucQuery.setParameter(anyString(), any())).thenReturn(gucQuery);

        service = new TwoFactorService(userRepository, totpService, tenantContext,
            entityManager, recoveryCodeService);

        user = new UserEntity();
        user.setId(USER);
        user.setEmail("owner@terrace.local");
        when(userRepository.findById(USER)).thenReturn(Optional.of(user));
        when(totpService.generateSecret()).thenReturn("NEWSECRETNEWSECRETNEWSECRETNEWSE");
        when(totpService.otpauthUri(anyString(), anyString())).thenReturn("otpauth://totp/x?secret=y");

        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new JwtClaims(USER, TENANT, null, List.of(), List.of(), Map.of(), null, true),
                null, List.of()));
    }

    @Test
    @DisplayName("first-time enrolment needs no code — there is no factor to prove yet")
    void firstEnrolmentNeedsNoCode() {
        user.setTotpSecret(null);

        assertThat(service.setup(null).otpauthUri()).isNotBlank();
        verify(userRepository).save(user);
        assertThat(user.getTotpSecret()).isEqualTo("NEWSECRETNEWSECRETNEWSECRETNEWSE");
    }

    @Test
    @DisplayName("re-pointing a LIVE factor without a code is refused, and changes nothing")
    void rePointingWithoutCodeIsRefused() {
        user.setTotpSecret(LIVE_SECRET);
        user.setTotpEnabled(true);

        assertThatThrownBy(() -> service.setup(null))
            .isInstanceOf(AuthenticationFailedException.class);

        // The old secret must survive the refusal — a partially applied re-enrolment would be the
        // silent factor-removal this guard exists to stop.
        assertThat(user.getTotpSecret()).isEqualTo(LIVE_SECRET);
        assertThat(user.isTotpEnabled()).isTrue();
        verify(userRepository, never()).save(any(UserEntity.class));
    }

    @Test
    @DisplayName("a WRONG code is refused just as a missing one is")
    void rePointingWithWrongCodeIsRefused() {
        user.setTotpSecret(LIVE_SECRET);
        user.setTotpEnabled(true);
        when(totpService.verify(eq(LIVE_SECRET), eq("000000"))).thenReturn(false);

        assertThatThrownBy(() -> service.setup("000000"))
            .isInstanceOf(AuthenticationFailedException.class);
        assertThat(user.getTotpSecret()).isEqualTo(LIVE_SECRET);
    }

    @Test
    @DisplayName("a RECOVERY code cannot re-point a live factor — that is the laundering path")
    void recoveryCodeCannotRePointALiveFactor() {
        user.setTotpSecret(LIVE_SECRET);
        user.setTotpEnabled(true);
        // A recovery code is not a TOTP code, so the verifier refuses it. Critically, the guard
        // must NOT fall back to proveSecondFactor(): honouring a recovery code here would hand an
        // attacker holding one printed list a brand-new factor plus a brand-new set of codes.
        when(totpService.verify(eq(LIVE_SECRET), anyString())).thenReturn(false);

        assertThatThrownBy(() -> service.setup("ABCDE-FGHJK"))
            .isInstanceOf(AuthenticationFailedException.class);

        verify(recoveryCodeService, never()).redeem(any(), anyString());
        assertThat(user.getTotpSecret()).isEqualTo(LIVE_SECRET);
    }

    @Test
    @DisplayName("a null code answers AuthenticationFailed, not whatever the verifier throws")
    void nullCodeIsAClientErrorNotAServerError() {
        user.setTotpSecret(LIVE_SECRET);
        user.setTotpEnabled(true);
        // A REAL verifier, deliberately: the mocked one returns false for an unstubbed null and so
        // agreed with the guard while the live service answered 500. Anything that is not
        // AuthenticationFailedException here becomes a 500 at the edge.
        TwoFactorService real = new TwoFactorService(userRepository, new TotpService(),
            tenantContextFor(), entityManagerFor(), recoveryCodeService);

        assertThatThrownBy(() -> real.setup(null))
            .isInstanceOf(AuthenticationFailedException.class);
        assertThatThrownBy(() -> real.setup("   "))
            .isInstanceOf(AuthenticationFailedException.class);
        assertThat(user.getTotpSecret()).isEqualTo(LIVE_SECRET);
    }

    private TenantContext tenantContextFor() {
        TenantContext tc = mock(TenantContext.class);
        when(tc.requireTenantId()).thenReturn(TENANT);
        return tc;
    }

    private EntityManager entityManagerFor() {
        EntityManager em = mock(EntityManager.class);
        Query q = mock(Query.class);
        when(em.createNativeQuery(anyString())).thenReturn(q);
        when(q.setParameter(anyString(), any())).thenReturn(q);
        return em;
    }

    @Test
    @DisplayName("a live authenticator code DOES allow re-enrolment")
    void liveCodeAllowsRePointing() {
        user.setTotpSecret(LIVE_SECRET);
        user.setTotpEnabled(true);
        when(totpService.verify(eq(LIVE_SECRET), eq("123456"))).thenReturn(true);

        assertThat(service.setup("123456").otpauthUri()).isNotBlank();
        assertThat(user.getTotpSecret()).isEqualTo("NEWSECRETNEWSECRETNEWSECRETNEWSE");
        assertThat(user.isTotpEnabled()).isFalse();
    }

    @Test
    @DisplayName("status reports codes that outlive a half-finished re-enrolment, not a soothing zero")
    void statusDoesNotHideLiveCodesWhileDisabled() {
        user.setTotpSecret(LIVE_SECRET);
        user.setTotpEnabled(false);            // mid re-enrolment
        when(recoveryCodeService.remaining(USER)).thenReturn(7L);

        var status = service.status();
        assertThat(status.enabled()).isFalse();
        // Previously hard-coded 0 here — a lie, because redeem() never consults totpEnabled.
        assertThat(status.recoveryCodesRemaining()).isEqualTo(7L);
    }
}
