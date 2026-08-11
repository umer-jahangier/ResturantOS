package io.restaurantos.hr.exception;

import io.restaurantos.shared.api.ApiError;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * hr-service-local exception handling, for exceptions the shared
 * {@link io.restaurantos.shared.api.GlobalExceptionHandler} cannot know about.
 *
 * <p>Ordered ahead of the shared advice deliberately. The shared advice ends in a catch-all
 * {@code @ExceptionHandler(Exception.class)}, and {@code ExceptionHandlerExceptionResolver}
 * picks the FIRST advice bean that can handle the exception — not the one with the most
 * specific signature across all beans. Without an explicit order, two unordered advices tie
 * and which one wins is registration-dependent.
 */
@RestControllerAdvice
@lombok.extern.slf4j.Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
public class HrExceptionHandler {

    private String traceId() {
        String t = MDC.get("traceId");
        return t != null ? t : "unknown";
    }

    /**
     * Step-up gate on payroll approval.
     *
     * <p>Until this handler existed, {@link TotpRequiredException} carried only a
     * {@code @ResponseStatus(UNAUTHORIZED)}, which never took effect: the shared advice's
     * catch-all resolves first, so a missing step-up came back as {@code 500 INTERNAL_ERROR}.
     * Clients could not distinguish "re-authenticate with a code" from "the server broke", and
     * the operator-facing log filled with false unhandled-exception stack traces.
     *
     * <p>403, not 401, on two counts. It matches finance-service's period-close gate, so the two
     * step-up-gated endpoints in the product answer identically. And the caller IS authenticated
     * — they are missing a factor, not a session — so a 401 would send the web client's
     * refresh-on-401 interceptor after a new access token, which cannot help: {@code totp_verified}
     * is deliberately not carried across refresh, so the retry would fail the same way.
     */
    @ExceptionHandler(TotpRequiredException.class)
    public ResponseEntity<ApiError> handleTotpRequired(TotpRequiredException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiError.of("TOTP_REQUIRED", ex.getMessage(), traceId()));
    }

    /**
     * An unrecognised or inactive biometric terminal gets 401, not 500.
     *
     * <p>{@code DeviceAuthException} carries {@code @ResponseStatus(UNAUTHORIZED)} and it has never
     * run: the shared advice ends in {@code @ExceptionHandler(Exception.class)} and
     * {@code ExceptionHandlerExceptionResolver} consults advices before the annotation, so the
     * catch-all won. Measured live through the gateway:
     *
     * <pre>GET /iclock/cdata?SN=UNKNOWN-DEVICE-999 → 500 INTERNAL_ERROR</pre>
     *
     * <p>The identical defect this class was created to fix, on a second exception in the same
     * service — which is the argument for the class existing rather than for another
     * {@code @ResponseStatus}.
     *
     * <p>It matters more here than a wrong status usually does. An ADMS terminal polls every 3–8
     * seconds forever, so an unknown device produced a 500 and a stack trace on every poll: a log
     * flood that buries real failures, and a device that can never learn it is unauthorised
     * because 500 reads as "the server is broken, retry" while 401 reads as "you are not enrolled".
     *
     * <p>The message is deliberately not echoed. The caller is an unauthenticated device on a
     * public path, and the exception's text names why the lookup failed — unknown serial versus
     * inactive versus bad token — which is exactly the distinction not to hand an attacker probing
     * serial numbers.
     */
    @ExceptionHandler(io.restaurantos.hr.adms.DeviceAuthException.class)
    public ResponseEntity<ApiError> handleDeviceAuth(io.restaurantos.hr.adms.DeviceAuthException ex) {
        log.warn("Device authentication refused: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiError.of("DEVICE_AUTH_FAILED", "Device not recognised", traceId()));
    }
}
