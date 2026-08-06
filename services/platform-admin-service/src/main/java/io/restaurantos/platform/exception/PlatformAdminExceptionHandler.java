package io.restaurantos.platform.exception;

import io.restaurantos.platform.service.ProvisioningService.ProvisioningException;
import io.restaurantos.shared.api.ApiError;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps the two platform-admin failures a SuperAdmin is expected to see and act on, so they stop
 * arriving as 500s.
 *
 * <p>shared-lib's {@code GlobalExceptionHandler} has a catch-all {@code Exception} handler; without
 * these mappings a refused downgrade and a failed provisioning are both "Internal Server Error",
 * which is indistinguishable from the service being broken. 13-10 recorded the provisioning case
 * explicitly and deferred it to "whoever exposes retry" — this plan does, so it is paid here.
 *
 * <p>{@code @Order} is load-bearing for the same reason it is on {@link PlatformAuthExceptionHandler}:
 * advices are consulted in {@code Ordered} sequence and the catch-all would otherwise win by
 * registration order, which is not a contract.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class PlatformAdminExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(PlatformAdminExceptionHandler.class);

    /**
     * 409, not 400: the request is well-formed and the caller is entitled to make it. What is wrong
     * is the state of the world — the tenant is using more than the target tier allows — and that is
     * precisely what CONFLICT means. A 400 would send an operator looking for a typo in their body.
     */
    @ExceptionHandler(TierLimitExceededException.class)
    public ResponseEntity<ApiError> handleTierLimit(TierLimitExceededException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    /**
     * A provisioning saga that failed and compensated. 409 rather than 500 because the common cause
     * is a state conflict the caller can resolve (a slug already held, an admin email already in
     * use), and because a 500 invites a retry of the whole request when what is needed is either a
     * different input or the retry endpoint against this same tenant.
     *
     * <p>Any resource a compensating action could not clean up is named in the message: an operator
     * reading the response knows what to touch without going to the logs. The records are also
     * logged at ERROR under {@code [saga][MANUAL-REPAIR-REQUIRED]} by the saga itself.
     */
    @ExceptionHandler(ProvisioningException.class)
    public ResponseEntity<ApiError> handleProvisioning(ProvisioningException ex) {
        String message = ex.getMessage();
        if (!ex.manualRepairs().isEmpty()) {
            message = message + " — manual repair required: " + ex.manualRepairs().stream()
                .map(r -> r.resourceKind() + "=" + r.resourceId())
                .reduce((a, b) -> a + ", " + b).orElse("");
        }
        log.warn("[platform-admin] provisioning failed: {}", message);
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiError.of("PROVISIONING_FAILED", message, traceId()));
    }

    /**
     * 400 for an argument the caller got wrong.
     *
     * <p>shared-lib's advice handles Spring's own malformed-request family but not
     * {@code IllegalArgumentException}, so a rejected argument raised inside a platform service —
     * an unknown tier name, a missing acting administrator, a tenant id that resolves to nothing —
     * fell through to the catch-all and came back as 500. That tells a SuperAdmin the server is
     * broken when their request is; it is also what made the internal impersonation refusal
     * indistinguishable from a crash.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError.of("BAD_REQUEST", ex.getMessage(), traceId()));
    }

    private static String traceId() {
        String traceId = org.slf4j.MDC.get("traceId");
        return traceId != null ? traceId : "unknown";
    }
}
