package io.restaurantos.reporting.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.restaurantos.reporting.dto.DashboardTileDto;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Dashboard WebSocket handler — cloned structurally from kitchen-service's proven
 * {@code KdsWebSocketHandler}: JWT-in-query-param auth (browsers cannot set headers on a WS
 * handshake), a {@code CloseStatus(1008, ...)} policy-violation close on any auth failure, and a
 * {@code CopyOnWriteArrayList}-backed subscriber registry guarded by {@code session.isOpen()}
 * before every send.
 *
 * <p>Differences from KDS: the path carries ONE variable ({@code branchId}, not
 * {@code branchId}/{@code stationId}), the required permission is
 * {@code reporting.dashboard.view} (seeded + granted by 12-11), and the registry is keyed by
 * {@code branchId} alone. {@code DashboardTileService} calls {@link #notifySubscribers} — through
 * {@link TilePushThrottle} — after each ORDER_CLOSED/TILL_CLOSED fact lands.
 */
@Component
public class DashboardWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(DashboardWebSocketHandler.class);
    private static final String REQUIRED_PERMISSION = "reporting.dashboard.view";

    private final JwksKeyProvider jwksKeyProvider;
    private final ObjectMapper objectMapper;

    // Key: branchId (as String) -> list of active WS sessions subscribed to that branch's dashboard.
    private final Map<String, List<WebSocketSession>> subscribers = new ConcurrentHashMap<>();

    public DashboardWebSocketHandler(JwksKeyProvider jwksKeyProvider, ObjectMapper objectMapper) {
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
        if (!validateJwtAndPermission(token, branchId)) {
            closeWithPolicy(session);
            return;
        }

        session.getAttributes().put("subscriptionKey", branchId);
        subscribers.computeIfAbsent(branchId, k -> new CopyOnWriteArrayList<>()).add(session);
        log.debug("Dashboard WebSocket connected: session={} branchId={}", session.getId(), branchId);
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
    }

    /**
     * Pushes the current tile snapshot to every subscriber of the given branch's dashboard.
     * Called by {@code DashboardTileService} after each throttle-granted recompute (immediate or
     * trailing-flush).
     */
    public void notifySubscribers(java.util.UUID branchId, List<DashboardTileDto> tiles) {
        String key = branchId.toString();
        List<WebSocketSession> sessions = subscribers.getOrDefault(key, Collections.emptyList());
        if (sessions.isEmpty()) {
            return;
        }
        try {
            String payload = objectMapper.writeValueAsString(tiles);
            TextMessage message = new TextMessage(payload);
            for (WebSocketSession session : sessions) {
                if (session.isOpen()) {
                    try {
                        session.sendMessage(message);
                    } catch (IOException e) {
                        log.warn("Failed to send dashboard WS message to session {}: {}", session.getId(), e.getMessage());
                    }
                }
            }
        } catch (IOException e) {
            log.error("Failed to serialize dashboard tiles for WebSocket push", e);
        }
    }

    private String extractBranchId(URI uri) {
        if (uri == null) return null;
        String path = uri.getPath();
        // Expected: /api/v1/reporting/dashboard/{branchId}
        // segments[0]="" [1]="api" [2]="v1" [3]="reporting" [4]="dashboard" [5]="branchId"
        String[] segments = path.split("/");
        if (segments.length < 6) return null;
        return segments[5];
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

    @SuppressWarnings("unchecked")
    private boolean validateJwtAndPermission(String token, String branchId) {
        if (token == null || token.isBlank()) {
            return false;
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
            return permissions != null && permissions.contains(REQUIRED_PERMISSION);
        } catch (Exception e) {
            log.debug("Dashboard WebSocket JWT validation failed for branchId={}: {}", branchId, e.getMessage());
            return false;
        }
    }

    private void closeWithPolicy(WebSocketSession session) {
        try {
            session.close(new CloseStatus(1008,
                    "Policy Violation: missing or invalid JWT with " + REQUIRED_PERMISSION));
        } catch (IOException e) {
            log.debug("Error closing dashboard WebSocket session: {}", e.getMessage());
        }
    }
}
