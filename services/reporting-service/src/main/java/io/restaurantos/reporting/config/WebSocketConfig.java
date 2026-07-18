package io.restaurantos.reporting.config;

import io.restaurantos.reporting.ws.DashboardWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers the dashboard WebSocket at {@code /api/v1/reporting/dashboard/{branchId}} — cloned
 * from kitchen-service's {@code WebSocketConfig}. The Spring Cloud Gateway {@code reporting-route}
 * (12-01) proxies the WS upgrade transparently over the same {@code Path=} predicate, exactly as
 * {@code kitchen-route} already serves the KDS socket, so no extra gateway filter is needed.
 * {@code ReportingSecurityConfig} permits the handshake path at the HTTP layer; the handler does
 * its own JWT-in-query-param check.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final DashboardWebSocketHandler dashboardWebSocketHandler;

    public WebSocketConfig(DashboardWebSocketHandler dashboardWebSocketHandler) {
        this.dashboardWebSocketHandler = dashboardWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(dashboardWebSocketHandler, "/api/v1/reporting/dashboard/{branchId}")
                .setAllowedOrigins("*");
    }
}
