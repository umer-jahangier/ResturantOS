package io.restaurantos.gateway.fallback;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * Circuit-breaker fallback endpoint.
 *
 * <p>Registered as {@code fallbackUri: forward:/fallback/service-unavailable} in
 * application.yml CircuitBreaker filter configurations. When an upstream trips its
 * circuit breaker (or returns a configured error status), Spring Cloud Gateway
 * internally forwards the request here instead of returning a raw error.
 *
 * <p>Returns HTTP 503 SERVICE_UNAVAILABLE with a JSON ApiError body, preventing
 * request hangs and providing a structured error for the client to parse.
 */
@RestController
public class FallbackController {

    private static final String SERVICE_UNAVAILABLE_BODY =
            "{\"error\":{\"code\":\"SERVICE_UNAVAILABLE\"," +
            "\"message\":\"The service is temporarily unavailable. Please try again later.\"}}";

    @RequestMapping(value = "/fallback/service-unavailable",
                    produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<ResponseEntity<String>> serviceUnavailable() {
        return Mono.just(
                ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(SERVICE_UNAVAILABLE_BODY)
        );
    }
}
