package io.restaurantos.shared.security;

import io.jsonwebtoken.Jwts;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.ThreadLocalTenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Covers the authority-construction contract of {@link JwtAuthenticationFilter} (audit B1, cause 2).
 *
 * <p>Before this test existed the filter derived authorities from the {@code permissions} claim
 * alone, so {@code @PreAuthorize("hasAuthority('SUPER_ADMIN'))} — the class-level gate on
 * {@code PlatformAdminController} — was unsatisfiable by any token, because SUPER_ADMIN is a role
 * and is in no permission catalog. These assertions pin the union so the regression cannot recur
 * silently.
 *
 * <p>Tokens are signed with a keypair generated here and trusted through
 * {@link JwksKeyProvider}'s pre-seeded test constructor: no dev keys, no HTTP, no JWKS fetch.
 */
class JwtAuthenticationFilterTest {

    private static final String KID = "unit-test-key";
    private static KeyPair keyPair;

    private JwtAuthenticationFilter filter;
    private TenantContext tenantContext;

    @BeforeAll
    static void generateKeys() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();
    }

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        MDC.clear();
        tenantContext = new ThreadLocalTenantContext();
        filter = new JwtAuthenticationFilter(
                new JwksKeyProvider(KID, (RSAPublicKey) keyPair.getPublic()), tenantContext);
    }

    // ── Behaviour 1: permissions and roles are unioned ───────────────────────────────────────

    @Test
    void permissionsAndRoles_bothBecomeAuthorities() throws Exception {
        String token = token(claims -> {
            claims.put("tenant_id", UUID.randomUUID().toString());
            claims.put("permissions", List.of("pos.order.create"));
            claims.put("roles", List.of("CASHIER"));
        });

        Result result = run(token);

        assertThat(result.chainCalled).isTrue();
        assertThat(authorityNames(result))
                .containsExactlyInAnyOrder("pos.order.create", "CASHIER");
    }

    // ── Behaviour 2: a value present in both claims is granted exactly once ──────────────────

    @Test
    void roleAlsoPresentAsPermission_isDeduplicated() throws Exception {
        String token = token(claims -> {
            claims.put("permissions", List.of("SUPER_ADMIN"));
            claims.put("roles", List.of("SUPER_ADMIN"));
        });

        Result result = run(token);

        assertThat(authorityNames(result)).containsExactly("SUPER_ADMIN");
    }

    // ── Behaviour 2b: a role alone is enough — this is the B1 unlock ─────────────────────────

    @Test
    void roleOnlyToken_yieldsThatRoleAsAuthority() throws Exception {
        String token = token(claims -> claims.put("roles", List.of("SUPER_ADMIN")));

        Result result = run(token);

        assertThat(result.chainCalled).isTrue();
        assertThat(authorityNames(result))
                .as("hasAuthority('SUPER_ADMIN') must be satisfiable by a role claim")
                .containsExactly("SUPER_ADMIN");
    }

    // ── Behaviour 3: no roles claim behaves exactly as before ────────────────────────────────

    @Test
    void nullRolesClaim_behavesAsBefore() throws Exception {
        String token = token(claims -> {
            claims.put("tenant_id", UUID.randomUUID().toString());
            claims.put("permissions", List.of("pos.order.create", "pos.till.open"));
        });

        Result result = run(token);

        assertThat(authorityNames(result))
                .containsExactly("pos.order.create", "pos.till.open");
    }

    // ── Behaviour 4: both claims absent — empty authorities, chain still proceeds, no NPE ────

    @Test
    void bothClaimsNull_yieldsEmptyAuthoritiesAndProceeds() throws Exception {
        String token = token(claims -> { /* neither roles nor permissions */ });

        Result result = run(token);

        assertThat(result.chainCalled).isTrue();
        assertThat(result.status).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(authorityNames(result)).isEmpty();
    }

    // ── Behaviour 5: tenant-less token proceeds, sets a null tenant, writes no MDC tenantId ──

    @Test
    void tenantLessToken_proceedsWithNullTenantAndNoMdcEntry() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = token(userId, claims -> claims.put("roles", List.of("SUPER_ADMIN")));

        AtomicReference<Map<String, String>> mdcDuringChain = new AtomicReference<>();
        AtomicReference<java.util.Optional<UUID>> tenantDuringChain = new AtomicReference<>();
        Result result = run(token, (req, res) -> {
            Map<String, String> copy = MDC.getCopyOfContextMap();
            mdcDuringChain.set(copy == null ? Map.of() : copy);
            tenantDuringChain.set(tenantContext.getTenantId());
        });

        assertThat(result.chainCalled).isTrue();
        assertThat(result.status).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(tenantDuringChain.get()).isEmpty();
        assertThat(mdcDuringChain.get()).doesNotContainKey("tenantId");
        assertThat(mdcDuringChain.get()).containsKey("traceId");
        assertThat(result.claims.subject()).isEqualTo(userId);
        assertThat(result.claims.tenantId()).isNull();
    }

    // ── Guard: the fail-closed totp default must survive this change ─────────────────────────

    @Test
    void absentTotpClaim_readsAsFalse() throws Exception {
        String token = token(claims -> claims.put("roles", List.of("SUPER_ADMIN")));

        Result result = run(token);

        assertThat(result.claims.totpVerified()).isFalse();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private interface ChainAction {
        void run(HttpServletRequest request, HttpServletResponse response);
    }

    private record Result(boolean chainCalled, int status, List<GrantedAuthority> authorities,
                          JwtClaims claims) {}

    private static List<String> authorityNames(Result result) {
        return result.authorities().stream().map(GrantedAuthority::getAuthority).toList();
    }

    private String token(java.util.function.Consumer<Map<String, Object>> customiser) {
        return token(UUID.randomUUID(), customiser);
    }

    private String token(UUID subject, java.util.function.Consumer<Map<String, Object>> customiser) {
        Map<String, Object> claims = new LinkedHashMap<>();
        customiser.accept(claims);
        Date now = new Date();
        var builder = Jwts.builder()
                .header().keyId(KID).and()
                .subject(subject.toString())
                .issuedAt(now)
                .expiration(new Date(now.getTime() + 3_600_000));
        claims.forEach(builder::claim);
        return builder.signWith((RSAPrivateKey) keyPair.getPrivate(), Jwts.SIG.RS256).compact();
    }

    private Result run(String token) throws Exception {
        return run(token, null);
    }

    private Result run(String token, ChainAction duringChain) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/platform/tenants");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();

        List<GrantedAuthority> captured = new ArrayList<>();
        AtomicReference<JwtClaims> capturedClaims = new AtomicReference<>();
        boolean[] called = {false};

        FilterChain chain = (req, res) -> {
            called[0] = true;
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication != null) {
                captured.addAll(authentication.getAuthorities());
                capturedClaims.set((JwtClaims) authentication.getPrincipal());
            }
            if (duringChain != null) {
                duringChain.run((HttpServletRequest) req, (HttpServletResponse) res);
            }
        };

        filter.doFilter(request, response, chain);
        return new Result(called[0], response.getStatus(), captured, capturedClaims.get());
    }
}
