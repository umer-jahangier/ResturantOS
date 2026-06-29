package io.restaurantos.kitchen.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.restaurantos.kitchen.dto.KdsTicketDto;
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
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * KDS WebSocket handler. Authenticates each session via JWT in ?token= query param,
 * checks pos.kds.view permission, then registers the session for push notifications.
 * TicketServiceImpl calls notifySubscribers() after each ticket/item mutation.
 */
@Component
public class KdsWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(KdsWebSocketHandler.class);

    private final JwksKeyProvider jwksKeyProvider;
    private final ObjectMapper objectMapper;

    // Key: "branchId:stationCode" -> list of active WS sessions
    private final Map<String, List<WebSocketSession>> subscribers = new ConcurrentHashMap<>();

    public KdsWebSocketHandler(JwksKeyProvider jwksKeyProvider, ObjectMapper objectMapper) {
        this.jwksKeyProvider = jwksKeyProvider;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String[] pathVars = extractPathVars(session.getUri());
        if (pathVars == null) {
            closeWithPolicy(session);
            return;
        }
        String branchId = pathVars[0];
        String stationId = pathVars[1];

        String token = extractToken(session.getUri());
        if (!validateJwtAndPermission(token, branchId)) {
            closeWithPolicy(session);
            return;
        }

        String key = branchId + ":" + stationId;
        session.getAttributes().put("subscriptionKey", key);
        subscribers.computeIfAbsent(key, k -> new CopyOnWriteArrayList<>()).add(session);
        log.debug("KDS WebSocket connected: session={} key={}", session.getId(), key);
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
     * Pushes a ticket update JSON frame to all subscribers of the given branch+station.
     * Called by TicketServiceImpl after each mutation.
     */
    public void notifySubscribers(UUID branchId, String stationCode, KdsTicketDto dto) {
        String key = branchId + ":" + stationCode;
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
                        log.warn("Failed to send WS message to session {}: {}", session.getId(), e.getMessage());
                    }
                }
            }
        } catch (IOException e) {
            log.error("Failed to serialize KdsTicketDto for WebSocket push", e);
        }
    }

    private String[] extractPathVars(URI uri) {
        if (uri == null) return null;
        String path = uri.getPath();
        // Expected: /api/v1/kitchen/kds/{branchId}/{stationId}
        String[] segments = path.split("/");
        // segments[0]="" segments[1]="api" segments[2]="v1" segments[3]="kitchen" segments[4]="kds" segments[5]="branchId" segments[6]="stationId"
        if (segments.length < 7) return null;
        return new String[]{segments[5], segments[6]};
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
            return permissions != null && permissions.contains("pos.kds.view");
        } catch (Exception e) {
            log.debug("WebSocket JWT validation failed: {}", e.getMessage());
            return false;
        }
    }

    private void closeWithPolicy(WebSocketSession session) {
        try {
            session.close(new CloseStatus(1008, "Policy Violation: missing or invalid JWT with pos.kds.view"));
        } catch (IOException e) {
            log.debug("Error closing WebSocket session: {}", e.getMessage());
        }
    }
}
