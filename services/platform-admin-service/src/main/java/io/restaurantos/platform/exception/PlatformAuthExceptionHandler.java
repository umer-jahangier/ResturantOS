package io.restaurantos.platform.exception;

import io.restaurantos.shared.api.ApiError;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps the platform login refusal to a 401 whose body is a compile-time constant.
 *
 * <h3>Why the body is a constant and not built per request</h3>
 * <p>The security property this endpoint has to hold is that a failed login reveals nothing about
 * the account — not in the status, not in the body, not in the timing. Assembling the body per
 * request from a message and an MDC trace id makes that property an <i>empirical observation</i>
 * ("the two responses happened to come out equal") rather than a structural one. It is also
 * genuinely fragile here: the trace id is written by {@code JwtAuthenticationFilter}, which does
 * not run for an unauthenticated request, so whether {@code MDC.get("traceId")} is empty depends on
 * what the Tomcat worker thread did previously. Two failed logins could differ by a stale id.
 *
 * <p>So the body is fixed, and it is fixed at exactly the value the dynamic form produces when the
 * MDC is empty — {@code traceId: "unknown"} — so the wire shape is unchanged from every other error
 * in this platform. Correlation for a genuinely stuck operator is not lost: {@code
 * PlatformAuthService} logs the refusal with its reason, the platform user id where one exists and
 * the source address.
 *
 * <p><b>{@code @Order(HIGHEST_PRECEDENCE)} is load-bearing.</b> {@code @RestControllerAdvice} beans
 * are consulted in {@code Ordered} sequence and the first bean with a matching handler method wins.
 * shared-lib's {@code GlobalExceptionHandler} has a catch-all {@code Exception} handler that would
 * turn this into a 500 if it were consulted first; unordered advices fall back to bean-registration
 * order, which is not a contract. Pinning the order makes the mapping deterministic instead of
 * incidental.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class PlatformAuthExceptionHandler {

    /**
     * The single refusal body. Every failing platform login returns this object, byte for byte.
     * {@code PlatformAuthIT} compares the unknown-email, wrong-password, inactive-account,
     * wrong-role and locked-out responses against each other rather than merely checking that all
     * five are 401 — a status match alone would still pass if one of them grew a helpful message.
     */
    static final ApiError GENERIC_REFUSAL =
        ApiError.of("UNAUTHENTICATED", "Invalid credentials", "unknown");

    @ExceptionHandler(PlatformAuthenticationFailedException.class)
    public ResponseEntity<ApiError> handlePlatformAuthFailure(PlatformAuthenticationFailedException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(GENERIC_REFUSAL);
    }
}
