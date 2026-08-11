package io.restaurantos.kitchen.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
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
 * A KDS subscription must be confined to the branch named in the caller's own token.
 *
 * <h2>The defect this pins</h2>
 *
 * {@code validateJwtAndPermission(String token, String branchId)} took the branch as a parameter
 * and never read it. The whole check was "does this token hold {@code pos.kds.view}" — a
 * permission KITCHEN_STAFF holds, and that role carries exactly two permissions. So any kitchen
 * account, at any tenant, could subscribe to ANY branch of ANY other tenant and watch their live
 * tickets arrive: order contents, table numbers and timings, in real time as they were fired.
 *
 * <p>Nothing upstream could have saved it. The gateway must permit {@code ?token=} on this path
 * because a browser's native WebSocket API cannot set an {@code Authorization} header on the
 * handshake, so the handler is the only place the scope can be enforced — and row-level security
 * does not reach a subscriber list held in a {@code ConcurrentHashMap}.
 *
 * <p>It survived because this handler had <b>no test file at all</b>. The identical copy in
 * reporting-service leaked live revenue the same way, which is what a copied handler does with a
 * defect.
 */
class KdsWebSocketBranchScopeTest {

    private static final String KID = "test-kid";
    private static KeyPair keyPair;
    private static KdsWebSocketHandler handler;

    @BeforeAll
    static void setUp() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();
        // Pre-seeded provider: no JWKS fetch, no network, no timing dependency.
        handler = new KdsWebSocketHandler(new JwksKeyProvider(KID, keyPair.getPublic()), new ObjectMapper());
    }

    private String token(String tenantId, String branchId, List<String> permissions) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenantId);
        claims.put("branch_id", branchId);
        claims.put("permissions", permissions);
        return Jwts.builder()
                .header().keyId(KID).and()
                .subject(UUID.randomUUID().toString())
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 600_000))
                .signWith(keyPair.getPrivate())
                .compact();
    }

    /** Drives the real entry point and reports whether the socket was closed. */
    private CloseStatus connect(String branchInUrl, String jwt) throws Exception {
        AtomicReference<CloseStatus> closed = new AtomicReference<>();
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("test-session");
        // The path must be exactly what extractPathVars expects — /api/v1/kitchen/kds/{branch}/{station}.
        // My first version omitted the `kds` segment, so the parser returned null and the socket
        // closed before authorization ran: the three refusal tests passed for entirely the wrong
        // reason, and only the acceptance control revealed it. That is the whole argument for
        // pairing every "must be refused" assertion with a "must still work" one.
        when(session.getUri()).thenReturn(URI.create(
                "ws://localhost/api/v1/kitchen/kds/" + branchInUrl + "/" + UUID.randomUUID() + "?token=" + jwt));
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        org.mockito.Mockito.doAnswer(inv -> {
            closed.set(inv.getArgument(0));
            return null;
        }).when(session).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));

        handler.afterConnectionEstablished(session);
        return closed.get();
    }

    @Test
    void aTokenForAnotherTenantsBranch_isRefused() throws Exception {
        String victimBranch = UUID.randomUUID().toString();
        String attacker = token(UUID.randomUUID().toString(), UUID.randomUUID().toString(),
                List.of("pos.kds.view"));

        assertThat(connect(victimBranch, attacker))
                .as("a token scoped to a different branch must not open a KDS stream — it holds "
                        + "pos.kds.view, which is all the old check looked at")
                .isNotNull();
    }

    @Test
    void aTokenForItsOwnBranch_isAccepted() throws Exception {
        // The control. Without it, a handler that refused everything would pass the test above,
        // and "nobody can use the KDS" is not the fix.
        String branch = UUID.randomUUID().toString();
        String legitimate = token(UUID.randomUUID().toString(), branch, List.of("pos.kds.view"));

        assertThat(connect(branch, legitimate))
                .as("a kitchen user must still be able to watch their OWN branch")
                .isNull();
    }

    @Test
    void aTokenWithNoBranchScope_isRefused() throws Exception {
        // A tenant-less or branch-less token (the platform token shape) must not open a stream.
        String branch = UUID.randomUUID().toString();
        Map<String, Object> claims = new HashMap<>();
        claims.put("permissions", List.of("pos.kds.view"));
        String scopeless = Jwts.builder()
                .header().keyId(KID).and()
                .subject(UUID.randomUUID().toString())
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 600_000))
                .signWith(keyPair.getPrivate())
                .compact();

        assertThat(connect(branch, scopeless))
                .as("fail closed: no tenant/branch claim means no subscription")
                .isNotNull();
    }

    @Test
    void aTokenWithoutThePermission_isStillRefused() throws Exception {
        // The pre-existing guarantee. The branch check is additive; it must not have replaced
        // the permission check.
        String branch = UUID.randomUUID().toString();
        String noPerm = token(UUID.randomUUID().toString(), branch, List.of("pos.order.view"));

        assertThat(connect(branch, noPerm))
                .as("pos.kds.view is still required")
                .isNotNull();
    }
}
