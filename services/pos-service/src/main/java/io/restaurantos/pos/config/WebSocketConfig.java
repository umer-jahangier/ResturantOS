package io.restaurantos.pos.config;

import io.restaurantos.pos.ws.PosOrderWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers the POS order WebSocket endpoint. Mirrors kitchen-service's
 * {@code WebSocketConfig} (raw Spring WebSocket, no STOMP/SockJS). A dedicated
 * {@code /api/v1/pos/ws/orders/{branchId}} path is used (rather than reusing the REST
 * {@code /api/v1/pos/orders} namespace) so the handshake can be permit-listed in
 * {@link PosSecurityConfig} without loosening auth on the REST order endpoints.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final PosOrderWebSocketHandler posOrderWebSocketHandler;

    public WebSocketConfig(PosOrderWebSocketHandler posOrderWebSocketHandler) {
        this.posOrderWebSocketHandler = posOrderWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(posOrderWebSocketHandler, "/api/v1/pos/ws/orders/{branchId}")
                .setAllowedOrigins("*");
    }
}
