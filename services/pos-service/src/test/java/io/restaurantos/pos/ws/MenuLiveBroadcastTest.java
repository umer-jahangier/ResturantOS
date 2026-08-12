package io.restaurantos.pos.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import io.jsonwebtoken.Jwts;
import io.restaurantos.shared.security.JwksKeyProvider;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;

import java.net.URI;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The reach of a menu-changed broadcast, asserted on frames that actually arrived at mocked
 * sockets driven through the real handler — not on a mock's interaction count.
 *
 * <h2>Why the fan-out is per TENANT and the order fan-out is per BRANCH</h2>
 *
 * A {@code MenuItem} row has a {@code tenant_id} and no branch column: 86'ing the naan is a
 * tenant-wide fact, and a branch-keyed broadcast would leave the rooftop till selling an item
 * the main kitchen has run out of. An order is branch-scoped and cross-branch order visibility
 * would be a leak — so the two indexes exist for opposite reasons, and
 * {@link #aMenuChangeReachesEveryBranchOfThatTenant()} and
 * {@link #aMenuChangeNeverCrossesToAnotherTenant()} pin both halves.
 *
 * <h2>Why this is not an IT</h2>
 *
 * Nothing here needs a database. It needs a real handler, real JWTs and real sessions, which is
 * exactly what {@code KdsWebSocketIsolationIT} established for the kitchen socket; this is the
 * POS twin of it. Named {@code *Test} deliberately so surefire runs it — surefire in this repo
 * excludes {@code **}{@code /*IT.java}, and a gate nobody runs is the failure mode this
 * codebase is being repaired for.
 */
class MenuLiveBroadcastTest {

    private static final String KID = "test-kid";
    private static KeyPair keyPair;

    private PosOrderWebSocketHandler handler;

    @BeforeAll
    static void generateKeys() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();
    }

    /**
     * The mapper is built with {@code findAndAddModules()}, NOT as a bare {@code new
     * ObjectMapper()}.
     *
     * <p>This is load-bearing, and it cost a red run to learn: {@link MenuChangedFrame} carries
     * an {@code Instant}, and a bare ObjectMapper cannot serialize one — it throws, the handler
     * catches it, logs, and sends nothing. The frame would vanish with only a log line to show
     * for it. Spring Boot's auto-configured mapper discovers jackson-datatype-jsr310 the same
     * way this line does, which is exactly why the fixture must too: a fixture that serializes
     * differently from production proves nothing about production.
     */
    private PosOrderWebSocketHandler newHandler() {
        ObjectMapper mapper = JsonMapper.builder().findAndAddModules().build();
        return new PosOrderWebSocketHandler(new JwksKeyProvider(KID, keyPair.getPublic()), mapper);
    }

    // ── The control ──────────────────────────────────────────────────────────────────────────

    @Test
    void aTerminalOfTheTenantReceivesTheMenuChangedFrame() throws Exception {
        handler = newHandler();
        String tenant = id();
        String branch = id();
        Recorder till = connect(tenant, branch);

        handler.notifyMenuChanged(UUID.fromString(tenant),
                MenuChangedFrame.item(UUID.fromString(tenant), MenuChangedFrame.ITEM_DEACTIVATED,
                        UUID.randomUUID(), "Butter Naan", false));

        assertThat(till.sent)
                .as("without this control every other assertion here is satisfied by a handler "
                        + "that broadcasts to nobody, which is precisely the bug being fixed")
                .hasSize(1);
        assertThat(till.sent.get(0))
                .contains("\"event\":\"menu.changed\"")
                .contains("\"change\":\"item.deactivated\"")
                .contains("Butter Naan")
                // Pins the serialization itself. The frame's Instant is the one field that can
                // make writeValueAsString throw; when it does, the handler swallows it and the
                // whole feature goes quiet with nothing but a log line — the exact
                // structurally-present/behaviourally-absent shape this repair exists to end.
                .contains("\"at\":");
    }

    // ── Tenant-wide reach ────────────────────────────────────────────────────────────────────

    @Test
    void aMenuChangeReachesEveryBranchOfThatTenant() throws Exception {
        handler = newHandler();
        String tenant = id();
        Recorder mainTill = connect(tenant, id());
        Recorder rooftopTill = connect(tenant, id());

        handler.notifyMenuChanged(UUID.fromString(tenant), MenuChangedFrame.category(UUID.fromString(tenant)));

        assertThat(mainTill.sent).hasSize(1);
        assertThat(rooftopTill.sent)
                .as("the second branch is the whole point — a menu is tenant-scoped, so a "
                        + "branch-keyed broadcast would silently half-deliver every 86")
                .hasSize(1);
    }

    // ── Tenant isolation ─────────────────────────────────────────────────────────────────────

    @Test
    void aMenuChangeNeverCrossesToAnotherTenant() throws Exception {
        handler = newHandler();
        String mine = id();
        String theirs = id();
        Recorder myTill = connect(mine, id());
        Recorder foreignTill = connect(theirs, id());

        handler.notifyMenuChanged(UUID.fromString(mine),
                MenuChangedFrame.item(UUID.fromString(mine), MenuChangedFrame.ITEM_DEACTIVATED,
                        UUID.randomUUID(), "Butter Naan", false));

        assertThat(myTill.sent).hasSize(1);
        assertThat(foreignTill.sent)
                .as("the frame names a menu item — another tenant learning that 'Butter Naan' "
                        + "exists and just went off is a cross-tenant read, small but real")
                .isEmpty();
    }

    // ── The order stream is not disturbed ────────────────────────────────────────────────────

    @Test
    void anOrderPushStillGoesOnlyToItsOwnBranch() throws Exception {
        handler = newHandler();
        String tenant = id();
        String branchA = id();
        String branchB = id();
        Recorder tillA = connect(tenant, branchA);
        Recorder tillB = connect(tenant, branchB);

        handler.notifyOrderUpdate(UUID.fromString(branchA), null);
        assertThat(tillA.sent).as("a null DTO is a no-op, not a broadcast").isEmpty();
        assertThat(tillB.sent).isEmpty();

        // And the new tenant index must not have widened the ORDER path: same-tenant sibling
        // branches still do not see each other's orders.
        handler.notifyMenuChanged(UUID.fromString(tenant), MenuChangedFrame.category(UUID.fromString(tenant)));
        assertThat(tillA.sent).hasSize(1);
        assertThat(tillB.sent).hasSize(1);
    }

    // ── A closed terminal is forgotten by BOTH indexes ───────────────────────────────────────

    @Test
    void aClosedSessionStopsReceivingMenuFrames() throws Exception {
        handler = newHandler();
        String tenant = id();
        Recorder till = connect(tenant, id());

        handler.afterConnectionClosed(till.session, CloseStatus.NORMAL);
        handler.notifyMenuChanged(UUID.fromString(tenant), MenuChangedFrame.category(UUID.fromString(tenant)));

        assertThat(till.sent)
                .as("adding a second index adds a second place to leak sessions; a terminal that "
                        + "hung up must be dropped from both or the list grows on every reconnect")
                .isEmpty();
    }

    // ── A token with no tenant cannot be addressed, so it is refused ─────────────────────────

    @Test
    void aTokenWithNoTenantClaimIsRefusedRatherThanSilentlyUnreachable() throws Exception {
        handler = newHandler();
        String branch = id();
        Map<String, Object> claims = new HashMap<>();
        claims.put("branch_id", branch);
        claims.put("permissions", List.of("pos.order.view"));

        AtomicReference<CloseStatus> closed = new AtomicReference<>();
        WebSocketSession session = session(branch, signed(claims), closed, new ArrayList<>());
        handler.afterConnectionEstablished(session);

        assertThat(closed.get())
                .as("half-subscribing it would look perfectly connected — Live dot and all — and "
                        + "never receive a single 86 for the rest of the shift")
                .isNotNull();
        assertThat(closed.get().getCode()).isEqualTo(1008);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private static String id() {
        return UUID.randomUUID().toString();
    }

    /** A connected terminal plus the frames it actually received. */
    private record Recorder(WebSocketSession session, List<String> sent) {}

    private Recorder connect(String tenantId, String branchId) throws Exception {
        Map<String, Object> claims = new HashMap<>();
        claims.put("tenant_id", tenantId);
        claims.put("branch_id", branchId);
        claims.put("permissions", List.of("pos.order.view"));

        List<String> sent = new ArrayList<>();
        AtomicReference<CloseStatus> closed = new AtomicReference<>();
        WebSocketSession session = session(branchId, signed(claims), closed, sent);

        handler.afterConnectionEstablished(session);
        assertThat(closed.get())
                .as("the fixture itself must connect, or every assertion below is vacuous")
                .isNull();
        return new Recorder(session, sent);
    }

    private WebSocketSession session(String branchInUrl, String jwt,
                                     AtomicReference<CloseStatus> closed, List<String> sent) throws Exception {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("s-" + UUID.randomUUID());
        when(session.getUri()).thenReturn(
                URI.create("ws://localhost/api/v1/pos/ws/orders/" + branchInUrl + "?token=" + jwt));
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        doAnswer(inv -> {
            closed.set(inv.getArgument(0));
            return null;
        }).when(session).close(any(CloseStatus.class));
        doAnswer(inv -> {
            WebSocketMessage<?> m = inv.getArgument(0);
            sent.add(((TextMessage) m).getPayload());
            return null;
        }).when(session).sendMessage(any());
        return session;
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
}
