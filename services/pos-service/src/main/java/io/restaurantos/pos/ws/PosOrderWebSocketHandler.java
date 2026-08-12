package io.restaurantos.pos.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtClaims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.security.PublicKey;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * POS order WebSocket handler — the POS-side twin of kitchen's
 * {@code KdsWebSocketHandler}. A cashier terminal opens ONE branch-keyed connection and
 * receives live {@link OrderDto} pushes whenever a kitchen→pos event mutates an order in
 * that branch (per-item status change, order-ready), so the terminal reflects kitchen
 * progress (ACCEPTED/PREPARING/READY/SERVED) without waiting on the fallback poll.
 *
 * <p>Authentication (a NEW external surface): each session is authenticated via a JWT in
 * the {@code ?token=} query param — signature + expiry are verified against the JWKS,
 * {@code pos.order.view} permission is required, AND the token's {@code branch_id} claim
 * MUST equal the {@code {branchId}} path variable (a terminal must never subscribe to
 * another branch's order stream). Any failure closes the socket with policy-violation 1008.
 * Mirrors {@code KdsWebSocketHandler} exactly, adding the branch-match check the KDS path
 * did not need (its station key is not a security boundary the same way).
 */
@Component
public class PosOrderWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(PosOrderWebSocketHandler.class);

    private static final String VIEW_PERMISSION = "pos.order.view";

    private final JwksKeyProvider jwksKeyProvider;
    private final ObjectMapper objectMapper;

    // Key: branchId (string) -> list of active WS sessions subscribed to that branch.
    private final Map<String, List<WebSocketSession>> subscribers = new ConcurrentHashMap<>();

    // Key: tenantId (string) -> the same sessions, indexed the other way.
    //
    // Menu items and categories are TENANT-scoped rows (MenuItem.tenantId; there is no
    // branch column), so "86 the naan" is a tenant-wide fact and every branch's terminals
    // need it — a branch-only index would leave the rooftop till selling an item the main
    // kitchen has run out of. Orders stay branch-indexed because an order IS branch-scoped
    // and cross-branch order visibility would be a leak.
    private final Map<String, List<WebSocketSession>> tenantSubscribers = new ConcurrentHashMap<>();

    public PosOrderWebSocketHandler(JwksKeyProvider jwksKeyProvider, ObjectMapper objectMapper) {
        this.jwksKeyProvider = jwksKeyProvider;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String branchId = extractBranchId(session.getUri());
        if (branchId == null) {
            closeWithPolicy(session);
            return;
        }

        String token = extractToken(session.getUri());
        String tenantId = validateJwtAndReadTenant(token, branchId);
        if (tenantId == null) {
            closeWithPolicy(session);
            return;
        }

        session.getAttributes().put("subscriptionKey", branchId);
        session.getAttributes().put("tenantKey", tenantId);
        subscribers.computeIfAbsent(branchId, k -> new CopyOnWriteArrayList<>()).add(session);
        tenantSubscribers.computeIfAbsent(tenantId, k -> new CopyOnWriteArrayList<>()).add(session);
        log.debug("POS order WebSocket connected: session={} branchId={} tenantId={}",
                session.getId(), branchId, tenantId);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String key = (String) session.getAttributes().get("subscriptionKey");
        if (key != null) {
            List<WebSocketSession> sessions = subscribers.get(key);
            if (sessions != null) {
                sessions.remove(session);
            }
        }
        // Both indexes hold the SAME session object; missing this removal would leak a closed
        // session per reconnect and the menu broadcast would walk a growing list of dead ones.
        String tenantKey = (String) session.getAttributes().get("tenantKey");
        if (tenantKey != null) {
            List<WebSocketSession> sessions = tenantSubscribers.get(tenantKey);
            if (sessions != null) {
                sessions.remove(session);
            }
        }
    }

    /**
     * Pushes an updated {@link OrderDto} JSON frame to every terminal subscribed to the
     * order's branch. Called by the kitchen→pos consumers after they persist an update,
     * WHILE the message-scope TenantContext (and JPA transaction) is still open so the DTO
     * — including lazy item/modifier collections — is fully resolved before serialization.
     */
    public void notifyOrderUpdate(UUID branchId, OrderDto dto) {
        if (branchId == null || dto == null) {
            return;
        }
        String key = branchId.toString();
        List<WebSocketSession> sessions = subscribers.getOrDefault(key, Collections.emptyList());
        if (sessions.isEmpty()) {
            return;
        }
        try {
            String payload = objectMapper.writeValueAsString(dto);
            TextMessage message = new TextMessage(payload);
            for (WebSocketSession session : sessions) {
                if (session.isOpen()) {
                    try {
                        session.sendMessage(message);
                    } catch (IOException e) {
                        log.warn("Failed to send POS WS message to session {}: {}", session.getId(), e.getMessage());
                    }
                }
            }
        } catch (IOException e) {
            log.error("Failed to serialize OrderDto for POS WebSocket push", e);
        }
    }

    /**
     * Pushes a {@link MenuChangedFrame} to EVERY terminal of the tenant, on every branch.
     *
     * <p>This is the missing half of "86 an item and have it disappear from the tills"
     * (register S1 #13). The transport, the auth and the per-branch subscription all already
     * existed and were already open on the cashier's terminal; what did not exist was any
     * message on it that said the menu had changed, so a deactivation reached only the React
     * Query cache of the tab that performed it. Measured before the fix: manager deactivates
     * "Butter Naan", cashier's open till still shows it tappable at +2/+5/+10/+20s and drops
     * it only on F5.
     *
     * <p>Called from {@code MenuLiveNotifier} AFTER the menu transaction commits — never from
     * inside it. Pushing pre-commit would race the terminal's re-read against the very write
     * that triggered it and could re-cache the OLD menu, which is a worse failure than the one
     * being fixed because it looks like it worked.
     *
     * <p><b>Single-instance scope, stated plainly:</b> like {@link #notifyOrderUpdate}, this
     * reaches only sockets held by THIS JVM. With more than one pos-service replica behind the
     * gateway, terminals parked on another replica keep the old menu until their next read.
     * Fixing that needs a fanout exchange with a per-instance queue and belongs to whichever
     * change first runs pos-service at more than one replica; it is not a property this method
     * silently pretends to have.
     */
    public void notifyMenuChanged(UUID tenantId, MenuChangedFrame frame) {
        if (tenantId == null || frame == null) {
            return;
        }
        List<WebSocketSession> sessions =
                tenantSubscribers.getOrDefault(tenantId.toString(), Collections.emptyList());
        if (sessions.isEmpty()) {
            return;
        }
        try {
            TextMessage message = new TextMessage(objectMapper.writeValueAsString(frame));
            for (WebSocketSession session : sessions) {
                if (session.isOpen()) {
                    try {
                        session.sendMessage(message);
                    } catch (IOException e) {
                        log.warn("Failed to send POS menu-changed frame to session {}: {}",
                                session.getId(), e.getMessage());
                    }
                }
            }
            log.debug("POS menu-changed pushed: tenantId={} change={} sessions={}",
                    tenantId, frame.change(), sessions.size());
        } catch (IOException e) {
            log.error("Failed to serialize MenuChangedFrame for POS WebSocket push", e);
        }
    }

    private String extractBranchId(URI uri) {
        if (uri == null) return null;
        // Expected: /api/v1/pos/ws/orders/{branchId}
        // segments[0]="" [1]="api" [2]="v1" [3]="pos" [4]="ws" [5]="orders" [6]="{branchId}"
        // A dedicated /ws/ segment (NOT /api/v1/pos/orders/{branchId}) is used so the
        // handshake path can be permitAll-ed at the security chain WITHOUT overlapping the
        // authenticated REST order endpoints under /api/v1/pos/orders/** (GET /{id} etc.).
        String[] segments = uri.getPath().split("/");
        if (segments.length < 7) return null;
        String branchId = segments[6];
        return branchId.isBlank() ? null : branchId;
    }

    private String extractToken(URI uri) {
        if (uri == null || uri.getQuery() == null) return null;
        for (String param : uri.getQuery().split("&")) {
            if (param.startsWith("token=")) {
                return param.substring(6);
            }
        }
        return null;
    }

    /**
     * Validates the handshake token and, on success, returns the session's {@code tenant_id}.
     *
     * <p>Returns null for EVERY failure — bad signature, expired, missing permission, branch
     * mismatch, and now also a token with no tenant. That last one is a deliberate rejection
     * rather than a tolerated null: an untenanted session cannot be placed in the tenant index,
     * so it would silently never receive a menu update while looking perfectly connected. A
     * socket that cannot be addressed correctly is refused rather than half-subscribed.
     */
    @SuppressWarnings("unchecked")
    private String validateJwtAndReadTenant(String token, String pathBranchId) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            String kid = JwtClaims.peekKid(token);
            PublicKey publicKey = jwksKeyProvider.getKey(kid);

            Jws<Claims> jws = Jwts.parser()
                    .verifyWith(publicKey)
                    .build()
                    .parseSignedClaims(token);
            Claims claims = jws.getPayload();

            List<String> permissions = claims.get("permissions", List.class);
            if (permissions == null || !permissions.contains(VIEW_PERMISSION)) {
                return null;
            }

            // Branch isolation: the token's branch MUST match the branch this socket is
            // subscribing to. A terminal authenticated for branch A must not receive
            // branch B's order stream, even with a valid pos.order.view token.
            String tokenBranchId = claims.get("branch_id", String.class);
            if (tokenBranchId == null || !tokenBranchId.equals(pathBranchId)) {
                return null;
            }

            String tenantId = claims.get("tenant_id", String.class);
            return (tenantId == null || tenantId.isBlank()) ? null : tenantId;
        } catch (Exception e) {
            log.debug("POS WebSocket JWT validation failed: {}", e.getMessage());
            return null;
        }
    }

    private void closeWithPolicy(WebSocketSession session) {
        try {
            session.close(new CloseStatus(1008,
                    "Policy Violation: missing/invalid JWT, missing pos.order.view, or branch mismatch"));
        } catch (IOException e) {
            log.debug("Error closing POS WebSocket session: {}", e.getMessage());
        }
    }
}
