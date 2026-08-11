package io.restaurantos.kitchen.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.restaurantos.kitchen.authz.StationScope;
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
        if (!validateJwtAndPermission(token, branchId, stationId)) {
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
    private boolean validateJwtAndPermission(String token, String branchId, String stationCode) {
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
            if (permissions == null || !permissions.contains("pos.kds.view")) {
                return false;
            }

            // The branch in the URL must be the branch in the TOKEN.
            //
            // This method took `branchId` as a parameter and never looked at it. The only check
            // was "does this token hold pos.kds.view" — a permission KITCHEN_STAFF holds, and
            // that role carries exactly two permissions. So any kitchen account at any tenant
            // could subscribe to ANY branch of ANY other tenant and watch their live tickets:
            // order contents, table numbers, timings, in real time as they were fired.
            //
            // Nothing upstream saved it. The gateway permits ?token= on this path precisely
            // because a browser's WebSocket API cannot set an Authorization header, so the
            // handler is the only place the scope can be enforced — and RLS does not apply to a
            // subscription key held in a ConcurrentHashMap.
            //
            // ── On the tenant claim, stated precisely rather than flatteringly ──────────────
            //
            // The subscription path is /api/v1/kitchen/kds/{branchId}/{stationId}. It carries NO
            // tenant segment, so there is nothing here to compare a tenant claim AGAINST. What is
            // enforced is that the branch in the URL is the branch in the token, and a branch
            // belongs to exactly one tenant — so a token minted for tenant A cannot carry a branch
            // claim equal to a branch of tenant B, and branch equality is what actually closes the
            // cross-tenant read.
            //
            // The tenant claim is still REQUIRED, and its absence is a refusal. That is the
            // fail-closed posture, not a comparison: a token with no tenant scope (the platform
            // token shape) has no branch scope either and has no business on a board.
            //
            // This comment is deliberate. The version of this method before phase 28 accepted
            // `branchId` as a parameter and never read it, and the defect survived because nothing
            // said so out loud. Describing a check that does not exist is how the next reader
            // stops looking.
            String tokenTenant = claims.get("tenant_id", String.class);
            String tokenBranch = claims.get("branch_id", String.class);
            if (tokenTenant == null || tokenBranch == null) {
                log.debug("KDS WebSocket refused: token carries no tenant/branch scope");
                return false;
            }
            if (!tokenBranch.equals(branchId)) {
                // WARN, and it names both ids — the operator debugging a legitimately misconfigured
                // board needs to know which check failed. The CLIENT is told nothing: every refusal
                // closes with the same status and the same generic reason, because a close reason
                // that says whether the branch, the tenant or the permission was the problem is a
                // probe an attacker can run.
                log.warn("KDS WebSocket refused: token branch {} does not match requested branch {}",
                        tokenBranch, branchId);
                return false;
            }

            // ── Station scope (28-07, D-28-02) — LAST, and that ordering is the contract ──────
            //
            // Identity is fully established above: signature, permission, tenant and branch. Only
            // then is the caller's VIEW scope applied. A scope check placed earlier would be
            // deciding what a caller may watch before establishing who the caller is, and none of
            // the checks above may be reordered behind it or weakened by it.
            //
            // An ABSENT station attribute means unrestricted — every user in the product is in
            // that state, and reading it as an empty allow-list would refuse every kitchen socket
            // in every tenant the moment this deployed. See StationScope.
            if (!stationScopeOf(claims).permits(stationCode)) {
                log.warn("KDS WebSocket refused: station {} is outside the caller's assigned scope",
                        stationCode);
                return false;
            }
            return true;
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

    /**
     * The caller's station scope, read from the verified token's {@code attributes} map.
     *
     * <p>Resolved here rather than through {@code KdsAuthorizationService} because this handler
     * runs outside a Spring Security filter chain — a WebSocket handshake never populates the
     * {@code SecurityContext}, so there is no authenticated principal to read. The token is parsed
     * directly a few lines above for exactly that reason. The RULE, however, is the one in
     * {@link StationScope}, and it is applied through that type rather than reimplemented: every
     * degenerate input degrades to unrestricted, and no caller ever sees a raw collection it could
     * mistake for an empty allow-list.
     */
    private StationScope stationScopeOf(Claims claims) {
        // NESTED under `attributes`, not a top-level claim. JwtSigningService emits
        // `.claim("attributes", ...)` and auth-service's PermissionResolver puts the station list
        // inside that map, alongside approval_limit_paisa. Reading a top-level "stations" claim
        // would find nothing, produce an unrestricted scope for EVERY caller, and look exactly
        // like a working feature — the board would simply never be filtered, and no test that only
        // checked the unassigned case would notice.
        Object attributes = claims.get("attributes", Object.class);
        if (!(attributes instanceof java.util.Map<?, ?> attributeMap)) {
            return StationScope.unrestricted();
        }
        Object raw = attributeMap.get("stations");
        if (raw == null) {
            // The overwhelmingly common case: no assignment, sees everything.
            return StationScope.unrestricted();
        }
        if (!(raw instanceof java.util.Collection<?> collection)) {
            log.warn("KDS WebSocket: station scope claim is a {} rather than a list — treating "
                    + "the caller as unrestricted", raw.getClass().getSimpleName());
            return StationScope.unrestricted();
        }
        java.util.List<String> codes = new java.util.ArrayList<>();
        for (Object entry : collection) {
            if (entry instanceof String code) {
                codes.add(code);
            }
        }
        return StationScope.restrictedTo(codes);
    }
}
