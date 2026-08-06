package io.restaurantos.platform.exception;

import feign.FeignException;
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

    /**
     * An upstream refusal keeps its meaning; an upstream fault, and our own misconfiguration, do
     * not become the caller's problem.
     *
     * <p>Without this a {@code FeignException} is an ordinary {@code RuntimeException} as far as
     * shared-lib's catch-all is concerned, so every refusal from auth-service arrives at the
     * SuperAdmin as <b>500 INTERNAL_ERROR</b> — which makes "that user does not exist in that
     * tenant" indistinguishable from "the platform is broken", to the caller and on a dashboard
     * alike. 13-12 measured and closed exactly this in user-service; platform-admin-service grew a
     * delegating write for the first time in 13-13 and inherits the same hole.
     *
     * <p>Three rules, the same three {@code UpstreamErrorDecoder} applies:
     *
     * <ol>
     *   <li><b>A 4xx keeps its status</b> and the upstream's own {@code error.code} — 400
     *       {@code VALIDATION_FAILED}, 403 {@code ROLE_CEILING_EXCEEDED}, 404 {@code NOT_FOUND},
     *       409 {@code STATE_INVALID}.</li>
     *   <li><b>A 5xx never becomes a 4xx.</b> Downgrading a server fault tells the caller to
     *       rewrite a correct request forever and removes a real outage from every 5xx alert.</li>
     *   <li><b>Nothing internal leaks.</b> {@code FeignException.getMessage()} names the internal
     *       scheme, host, port and path; it is logged, never returned. Only the upstream's
     *       structured {@code error.message} crosses, and an undecodable body yields a fixed one.</li>
     * </ol>
     *
     * <p>And three 4xx are deliberately NOT passed through: {@code 401}, {@code 403
     * INTERNAL_AUTH_REQUIRED} and {@code 403 ACTING_USER_REQUIRED} all describe THIS service being
     * misconfigured, not anything the SuperAdmin did or can fix. Echoing them would ask an
     * authenticated operator to log in again over a fault they cannot see. They read as 502.
     */
    @ExceptionHandler(FeignException.class)
    public ResponseEntity<ApiError> handleUpstream(FeignException ex) {
        int status = ex.status();
        String upstreamCode = fieldOfErrorBody(ex, "code");

        // status() is 0 when the call never produced a response at all — connect refused, read
        // timeout, a RetryableException after the last attempt. That is an outage, not a refusal.
        boolean ourOwnMisconfiguration = status == 401
            || "INTERNAL_AUTH_REQUIRED".equals(upstreamCode)
            || "ACTING_USER_REQUIRED".equals(upstreamCode);
        if (status < 400 || status >= 500 || ourOwnMisconfiguration) {
            log.error("[platform-admin] upstream call failed (status={}, code={}): {}",
                status, upstreamCode, ex.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ApiError.of("UPSTREAM_ERROR",
                    "An upstream service could not complete this request", traceId()));
        }

        String message = fieldOfErrorBody(ex, "message");
        log.warn("[platform-admin] upstream refused (status={}, code={})", status, upstreamCode);
        return ResponseEntity.status(status)
            .body(ApiError.of(
                upstreamCode != null ? upstreamCode : "UPSTREAM_REJECTED",
                message != null ? message : "The upstream service refused this request",
                traceId()));
    }

    /**
     * One field of the upstream's {@code {"error":{...}}} envelope, or null.
     *
     * <p>Returns null rather than throwing on an undecodable body — an HTML proxy page, a truncated
     * response, an empty one. A decoder that throws while decoding an error turns a handled refusal
     * into an unhandled crash, which is the failure it exists to prevent.
     */
    private static String fieldOfErrorBody(FeignException ex, String field) {
        try {
            String value = MAPPER.readTree(ex.contentUTF8()).path("error").path(field).asText(null);
            return (value == null || value.isBlank()) ? null : value;
        } catch (Exception undecodable) {
            return null;
        }
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER =
        new com.fasterxml.jackson.databind.ObjectMapper();

    private static String traceId() {
        String traceId = org.slf4j.MDC.get("traceId");
        return traceId != null ? traceId : "unknown";
    }
}
