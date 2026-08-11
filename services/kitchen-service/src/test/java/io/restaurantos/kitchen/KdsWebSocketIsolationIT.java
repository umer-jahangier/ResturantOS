package io.restaurantos.kitchen;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.restaurantos.kitchen.ws.KdsWebSocketHandler;
import io.restaurantos.shared.security.JwksKeyProvider;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

import java.net.URI;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The KDS socket's full isolation contract (28-03, D-28-06) — every refusal path in one place,
 * asserted on the CLOSE STATUS rather than on the absence of pushed frames.
 *
 * <h2>Why the close status and not "no messages arrived"</h2>
 *
 * A socket that is open but silent during a quiet test window looks exactly like a socket that was
 * correctly refused. Asserting on silence would pass against a handler that admits everybody and
 * simply had nothing to send, which is the failure mode this file exists to make impossible.
 *
 * <h2>Why every refusal is asserted to be identical</h2>
 *
 * {@link #everyRefusalIsIndistinguishableFromEveryOther()} is the one that is easy to leave out. A
 * close reason naming <em>which</em> check failed — wrong branch, wrong tenant, missing permission,
 * bad signature — is a probe: an attacker holding one token learns which branch ids exist by
 * reading the difference. The operator's need for that information is real and is served by the
 * server-side log, which the client never sees.
 *
 * <p>This complements {@code ws/KdsWebSocketBranchScopeTest}, which pins the branch check that
 * closed the original cross-tenant read. That file is deliberately left untouched.
 */
class KdsWebSocketIsolationIT {

    private static final String KID = "test-kid";
    private static KeyPair keyPair;
    private static KdsWebSocketHandler handler;

    @BeforeAll
    static void setUp() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();
        handler = new KdsWebSocketHandler(new JwksKeyProvider(KID, keyPair.getPublic()), new ObjectMapper());
    }

    // ── Behaviour 1: the control ─────────────────────────────────────────────────────────────

    @Test
    void aTokenMatchingThePathBranch_withTheViewPermission_isAccepted() throws Exception {
        String branch = UUID.randomUUID().toString();

        assertThat(connect(branch, token(tenant(), branch, List.of("pos.kds.view"))))
                .as("without this control, a handler that refused everything would pass every "
                        + "other test in this file — and 'nobody can use the KDS' is not the fix")
                .isNull();
    }

    // ── Behaviour 2: a different branch, SAME tenant ─────────────────────────────────────────

    @Test
    void aDifferentBranchOfTheSameTenant_isRefused() throws Exception {
        // The case that is easy to miss, because it is not cross-tenant and therefore does not
        // look like a leak. It is one: a cook at the Gulberg branch has no business watching the
        // DHA branch's live tickets, and both branches belong to the same owner.
        String tenant = tenant();
        String ownBranch = UUID.randomUUID().toString();
        String siblingBranch = UUID.randomUUID().toString();

        assertThat(connect(siblingBranch, token(tenant, ownBranch, List.of("pos.kds.view"))))
                .isNotNull();
    }

    // ── Behaviour 3: another tenant entirely ─────────────────────────────────────────────────

    @Test
    void aTokenFromAnotherTenant_isRefused() throws Exception {
        String victimBranch = UUID.randomUUID().toString();

        assertThat(connect(victimBranch, token(tenant(), UUID.randomUUID().toString(),
                List.of("pos.kds.view"))))
                .as("a branch belongs to exactly one tenant, so a foreign token cannot carry a "
                        + "branch claim equal to this branch — branch equality is what closes this")
                .isNotNull();
    }

    // ── Behaviour 4: no branch claim at all ──────────────────────────────────────────────────

    @Test
    void aTokenWithNoBranchClaim_isRefusedRatherThanDefaultingToAccepted() throws Exception {
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenant());
        claims.put("permissions", List.of("pos.kds.view"));

        assertThat(connect(UUID.randomUUID().toString(), signed(claims)))
                .as("a check that admits when it cannot decide establishes nothing")
                .isNotNull();
    }

    // ── Behaviour 5: the pre-existing permission gate is additive-to, not replaced ───────────

    @Test
    void aTokenLackingTheViewPermission_isStillRefused() throws Exception {
        String branch = UUID.randomUUID().toString();

        assertThat(connect(branch, token(tenant(), branch, List.of("pos.order.view"))))
                .as("pos.kds.view stays required; the identity checks were added on top of it, "
                        + "never instead of it")
                .isNotNull();
    }

    // ── Behaviour 6: no token, and a token that does not verify ──────────────────────────────

    @Test
    void noTokenAtAll_isRefused() throws Exception {
        assertThat(connectRaw(UUID.randomUUID().toString(), null)).isNotNull();
    }

    @Test
    void aTokenSignedByTheWrongKey_isRefused() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        KeyPair impostor = gen.generateKeyPair();

        String branch = UUID.randomUUID().toString();
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenant());
        claims.put("branch_id", branch);
        claims.put("permissions", List.of("pos.kds.view"));
        String forged = Jwts.builder()
                .header().keyId(KID).and()
                .subject(UUID.randomUUID().toString())
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 600_000))
                .signWith(impostor.getPrivate())
                .compact();

        assertThat(connect(branch, forged))
                .as("every claim in it is correct; the signature is not, and that is the only "
                        + "thing that makes any of the claims mean anything")
                .isNotNull();
    }

    // ── Behaviour 7: every refusal looks the same to the client ──────────────────────────────

    @Test
    void everyRefusalIsIndistinguishableFromEveryOther() throws Exception {
        String tenant = tenant();
        String branch = UUID.randomUUID().toString();

        CloseStatus foreignBranch = connect(branch, token(tenant, UUID.randomUUID().toString(),
                List.of("pos.kds.view")));
        CloseStatus noPermission = connect(branch, token(tenant, branch, List.of("pos.order.view")));
        CloseStatus noToken = connectRaw(branch, null);
        CloseStatus scopeless = connect(branch, signed(Map.of("permissions", List.of("pos.kds.view"))));

        for (CloseStatus status : List.of(foreignBranch, noPermission, noToken, scopeless)) {
            assertThat(status).isNotNull();
            assertThat(status.getCode())
                    .as("a status that differs by cause is a discriminator")
                    .isEqualTo(1008);
            assertThat(status.getReason())
                    .as("a reason naming which check failed lets one token map which branch ids "
                            + "exist; the operator gets that from the server log instead")
                    .isEqualTo(foreignBranch.getReason());
        }
    }

    // ── Station scope on the socket (28-07, D-28-02) ─────────────────────────────────────────

    @Test
    void aScopedUsersSubscriptionToAStationInsideTheirScope_isAccepted() throws Exception {
        String branch = UUID.randomUUID().toString();

        assertThat(connectToStation(branch, "BAR", scopedToken(branch, List.of("BAR"))))
                .as("a bartender must still be able to watch the bar")
                .isNull();
    }

    @Test
    void aScopedUsersSubscriptionToAStationOutsideTheirScope_isRefusedIdentically() throws Exception {
        String branch = UUID.randomUUID().toString();

        CloseStatus outOfScope = connectToStation(branch, "GRILL", scopedToken(branch, List.of("BAR")));
        CloseStatus foreignBranch = connect(branch, token(tenant(), UUID.randomUUID().toString(),
                List.of("pos.kds.view")));

        assertThat(outOfScope).isNotNull();
        assertThat(outOfScope.getCode()).isEqualTo(1008);
        assertThat(outOfScope.getReason())
                .as("the scope refusal must be indistinguishable from every other refusal, or the "
                        + "close reason tells a cook which stations exist at the branch")
                .isEqualTo(foreignBranch.getReason());
    }

    @Test
    void anUnassignedUsersSubscriptionToAnyStationInTheirOwnBranch_isAccepted() throws Exception {
        // THE regression guard for the installed base on the socket path. Every user in the
        // product has no station assignment; if absent were read as an empty allow-list, every
        // live kitchen board would stop receiving pushes the moment this deployed.
        String branch = UUID.randomUUID().toString();

        assertThat(connectToStation(branch, "GRILL", token(tenant(), branch, List.of("pos.kds.view"))))
                .isNull();
        assertThat(connectToStation(branch, "BAR", token(tenant(), branch, List.of("pos.kds.view"))))
                .isNull();
    }

    @Test
    void aScopeAttributeOfTheWrongShape_leavesTheSocketOpenRatherThanBlackingOutTheBoard() throws Exception {
        String branch = UUID.randomUUID().toString();
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenant());
        claims.put("branch_id", branch);
        claims.put("permissions", List.of("pos.kds.view"));
        claims.put("attributes", Map.of("stations", "BAR"));

        assertThat(connectToStation(branch, "GRILL", signed(claims)))
                .as("a malformed token degrades OPEN — the alternative is a blank screen with no "
                        + "error anywhere, mid-service")
                .isNull();
    }

    /** A token carrying a station scope in the nested `attributes` map, as auth-service mints it. */
    private String scopedToken(String branchId, List<String> stations) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenant());
        claims.put("branch_id", branchId);
        claims.put("permissions", List.of("pos.kds.view"));
        // NESTED, exactly as JwtSigningService emits it. A top-level "stations" claim would find
        // nothing and un-scope every caller while looking like a working feature.
        claims.put("attributes", Map.of("stations", stations));
        return signed(claims);
    }

    private CloseStatus connectToStation(String branchInUrl, String stationCode, String jwt) throws Exception {
        AtomicReference<CloseStatus> closed = new AtomicReference<>();
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("test-session");
        when(session.getUri()).thenReturn(URI.create(
                "ws://localhost/api/v1/kitchen/kds/" + branchInUrl + "/" + stationCode + "?token=" + jwt));
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        org.mockito.Mockito.doAnswer(inv -> {
            closed.set(inv.getArgument(0));
            return null;
        }).when(session).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));

        handler.afterConnectionEstablished(session);
        return closed.get();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private static String tenant() {
        return UUID.randomUUID().toString();
    }

    private String token(String tenantId, String branchId, List<String> permissions) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenantId);
        claims.put("branch_id", branchId);
        claims.put("permissions", permissions);
        return signed(claims);
    }

    private String signed(Map<String, Object> claims) {
        return Jwts.builder()
                .header().keyId(KID).and()
                .subject(UUID.randomUUID().toString())
                .claims(new HashMap<>(claims))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 600_000))
                .signWith(keyPair.getPrivate())
                .compact();
    }

    private CloseStatus connect(String branchInUrl, String jwt) throws Exception {
        return connectRaw(branchInUrl, jwt);
    }

    /**
     * Drives the real entry point and reports the close status, or null if the socket stayed open.
     *
     * <p>The path must be exactly what {@code extractPathVars} expects —
     * {@code /api/v1/kitchen/kds/{branch}/{station}}. A path missing the {@code kds} segment makes
     * the parser return null and closes the socket <em>before</em> authorization runs, which would
     * make every refusal test here pass for entirely the wrong reason. That is what the acceptance
     * control in behaviour 1 is for.
     */
    private CloseStatus connectRaw(String branchInUrl, String jwt) throws Exception {
        AtomicReference<CloseStatus> closed = new AtomicReference<>();
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("test-session");
        String uri = "ws://localhost/api/v1/kitchen/kds/" + branchInUrl + "/" + UUID.randomUUID()
                + (jwt != null ? "?token=" + jwt : "");
        when(session.getUri()).thenReturn(URI.create(uri));
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        org.mockito.Mockito.doAnswer(inv -> {
            closed.set(inv.getArgument(0));
            return null;
        }).when(session).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));

        handler.afterConnectionEstablished(session);
        return closed.get();
    }
}
