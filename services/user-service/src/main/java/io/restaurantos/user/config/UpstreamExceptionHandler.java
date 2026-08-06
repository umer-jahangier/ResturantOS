package io.restaurantos.user.config;

import feign.FeignException;
import io.restaurantos.shared.api.ApiError;
import io.restaurantos.user.client.UpstreamClientException;
import io.restaurantos.user.client.UpstreamServiceException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Renders the outcome of a call to auth-service {@code /internal/auth/**} as an HTTP response.
 *
 * <p>The pairing with {@link io.restaurantos.user.client.UpstreamErrorDecoder} is deliberate: the
 * decoder decides <em>what kind of failure this was</em> (it is the only code with the upstream
 * body in hand); this advice decides <em>what the client is told</em>. Neither knows about the
 * other's concern, and there is exactly one place each decision is made.
 *
 * <p><b>{@code @Order(HIGHEST_PRECEDENCE)} is load-bearing.</b> {@code GlobalExceptionHandler} in
 * shared-lib declares {@code @ExceptionHandler(Exception.class)}, which matches everything. Spring
 * resolves an exception by walking the advice beans <em>in order</em> and taking the first that has
 * a matching method — so an unordered advice competing with that one wins or loses on bean
 * discovery order, which is not something to leave to chance for a handler whose entire job is to
 * stop refusals being reported as 500s.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class UpstreamExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(UpstreamExceptionHandler.class);

    private static String traceId() {
        String t = MDC.get("traceId");
        return t != null ? t : "unknown";
    }

    /**
     * The upstream refused on the merits. Status and code cross unchanged — that is the whole
     * point of the decoder — and the message is the upstream's own client-facing text, never a
     * Feign message or a body fragment.
     */
    @ExceptionHandler(UpstreamClientException.class)
    public ResponseEntity<ApiError> handleUpstreamClientError(UpstreamClientException ex) {
        return ResponseEntity.status(ex.status())
            .body(ApiError.of(ex.code(), ex.getMessage(), traceId()));
    }

    /**
     * The upstream broke, or refused us for a reason the caller had no part in. Always 502, never
     * a 4xx: a client told "your request was bad" will rewrite a correct request forever, and a
     * server fault reported as a client fault is invisible to every 5xx alert.
     */
    @ExceptionHandler(UpstreamServiceException.class)
    public ResponseEntity<ApiError> handleUpstreamServiceError(UpstreamServiceException ex) {
        String traceId = traceId();
        log.error("[{}] Upstream failure: {}", traceId, ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
            .body(ApiError.of("UPSTREAM_ERROR",
                "An internal service is unavailable — try again shortly", traceId));
    }

    /**
     * The call never produced a response at all: connect refused, read timeout, DNS failure,
     * {@code RetryableException} after the last attempt. The error decoder is not consulted for
     * these, so without this handler they still reach {@code handleUnexpected} — and a connection
     * refused to auth-service would be reported to the client identically to a bug in this service.
     *
     * <p>{@code FeignException.getMessage()} names the internal scheme, host, port and path. It is
     * logged and deliberately not returned.
     */
    @ExceptionHandler(FeignException.class)
    public ResponseEntity<ApiError> handleTransportFailure(FeignException ex) {
        String traceId = traceId();
        log.error("[{}] Upstream transport failure: {}", traceId, ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
            .body(ApiError.of("UPSTREAM_ERROR",
                "An internal service is unavailable — try again shortly", traceId));
    }
}
