package io.restaurantos.gateway.ops;

import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * {@code GET /api/v1/ops/health} — the fleet, as an operator can see it.
 *
 * <h3>Why the gateway serves this and not a service</h3>
 *
 * A health screen hosted inside one of the services it reports on can only ever tell you the truth
 * while nothing is wrong. The gateway is the one process the browser talks to; if IT is down the
 * frontend gets a transport error and can say so without help. Everything else is downstream of it,
 * so the gateway is the only vantage point from which "pos-service is not answering" is a statement
 * that can still be delivered.
 *
 * <h3>Shape</h3>
 *
 * <pre>
 * { "data": { "checkedAt": "2026-08-12T06:31:04Z",
 *             "services": [ { "name": "pos-service", "paths": ["/api/v1/pos/**"],
 *                             "state": "DOWN", "detail": "Not answering — …",
 *                             "lastReachableAt": "2026-08-12T06:28:59Z",
 *                             "instanceCount": 0 } ] } }
 * </pre>
 *
 * <p>{@code checkedAt} is null until the first sweep completes, and the screen says so rather than
 * drawing a fleet it has not measured yet.
 */
@RestController
public class FleetHealthController {

    private static final String UNAUTHENTICATED_BODY =
            "{\"error\":{\"code\":\"UNAUTHENTICATED\",\"message\":\"Authentication required\"}}";
    private static final String FORBIDDEN_BODY =
            "{\"error\":{\"code\":\"PERMISSION_DENIED\","
                    + "\"message\":\"You do not have permission to view service health.\"}}";

    private final FleetHealthMonitor monitor;
    private final OpsTokenAuthorizer authorizer;

    public FleetHealthController(FleetHealthMonitor monitor, OpsTokenAuthorizer authorizer) {
        this.monitor = monitor;
        this.authorizer = authorizer;
    }

    @GetMapping(value = "/api/v1/ops/health", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<ResponseEntity<?>> fleetHealth(ServerWebExchange exchange) {
        return switch (authorizer.authorize(exchange)) {
            case UNAUTHENTICATED -> Mono.just(ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .contentType(MediaType.APPLICATION_JSON).body(UNAUTHENTICATED_BODY));
            case FORBIDDEN -> Mono.just(ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .contentType(MediaType.APPLICATION_JSON).body(FORBIDDEN_BODY));
            case ALLOWED -> Mono.just(ResponseEntity.ok(ApiResponse.ok(monitor.current())));
        };
    }
}
