package io.restaurantos.shared.api;

import io.restaurantos.shared.exception.*;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private String traceId() { String t = MDC.get("traceId"); return t != null ? t : "unknown"; }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(PermissionDeniedException.class)
    public ResponseEntity<ApiError> handlePermission(PermissionDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiError.of("PERMISSION_DENIED", ex.getMessage(), traceId()));
    }

    /**
     * Spring Security method-level denials (@PreAuthorize / @PostAuthorize) propagate out of the
     * controller invocation as AuthorizationDeniedException (a subclass of AccessDeniedException in
     * Spring Security 6.4+/7). Without this handler they fall through to handleUnexpected() and are
     * mis-reported as 500 instead of 403 — this @RestControllerAdvice resolves the exception inside
     * DispatcherServlet, so it never reaches ExceptionTranslationFilter's normal 403 handling. That
     * silently defeated every @PreAuthorize check across every service sharing this handler.
     * Catching the supertype covers both types. The code matches the PERMISSION_DENIED emitted by
     * each service's SecurityConfig#accessDeniedHandler, so a filter-chain denial and a method
     * -security denial are indistinguishable to clients.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiError.of("PERMISSION_DENIED", "You do not have permission to perform this action", traceId()));
    }

    @ExceptionHandler(FeatureDisabledException.class)
    public ResponseEntity<ApiError> handleFeature(FeatureDisabledException ex, HttpServletResponse resp) {
        resp.setHeader("X-Upgrade-CTA-URL", "/billing/upgrade");
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiError.of("FEATURE_DISABLED", "This feature is not available on your current plan", traceId()));
    }

    @ExceptionHandler(QuotaExceededException.class)
    public ResponseEntity<ApiError> handleQuota(QuotaExceededException ex, HttpServletResponse resp) {
        resp.setHeader("X-Quota-Resource", ex.getResource());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(ApiError.of("QUOTA_EXCEEDED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(StateInvalidException.class)
    public ResponseEntity<ApiError> handleState(StateInvalidException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of("STATE_INVALID", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ApiError> handleIdem(IdempotencyConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of("IDEMPOTENCY_KEY_CONFLICT", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(PeriodLockedException.class)
    public ResponseEntity<ApiError> handlePeriod(PeriodLockedException ex) {
        return ResponseEntity.status(HttpStatus.LOCKED).body(ApiError.of("PERIOD_LOCKED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(TenantNotFoundException.class)
    public ResponseEntity<ApiError> handleTenant(TenantNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        List<ApiError.FieldError> details = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new ApiError.FieldError(fe.getField(), fe.getDefaultMessage())).toList();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError.of("VALIDATION_FAILED", "Request validation failed", details, traceId()));
    }

    /**
     * The malformed-request family Spring raises before a controller method ever runs.
     *
     * <p>{@link MethodArgumentNotValidException} above covers an invalid request BODY, and that was
     * the only one handled — so every other way of malforming a request fell through to
     * {@link #handleUnexpected} and came back as a 500. A missing {@code @RequestParam}, an id that
     * is not a UUID, a truncated JSON body, a GET sent to a POST-only path: all of them told the
     * caller the server had broken, when in each case the request had. Clients cannot distinguish
     * "retry, it's their fault" from "fix your request" if both are 500, and a 500 dashboard full of
     * ordinary client mistakes hides the real ones.
     *
     * <p>These are Spring framework types rather than application exceptions, so no service can fix
     * them locally; handling them once here fixes every service that shares this advice.
     */
    @ExceptionHandler({
        MissingServletRequestParameterException.class,
        MissingRequestHeaderException.class,
        MethodArgumentTypeMismatchException.class,
        HttpMessageNotReadableException.class,
        MissingServletRequestPartException.class
    })
    public ResponseEntity<ApiError> handleBadRequest(Exception ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError.of("BAD_REQUEST", describeBadRequest(ex), traceId()));
    }

    /** Names the offending parameter where the exception type exposes it, so the message is actionable. */
    private static String describeBadRequest(Exception ex) {
        return switch (ex) {
            case MissingServletRequestParameterException e ->
                "Required request parameter '%s' is missing".formatted(e.getParameterName());
            case MissingRequestHeaderException e ->
                "Required request header '%s' is missing".formatted(e.getHeaderName());
            case MethodArgumentTypeMismatchException e ->
                "Parameter '%s' has an invalid value".formatted(e.getName());
            case MissingServletRequestPartException e ->
                "Required request part '%s' is missing".formatted(e.getRequestPartName());
            case HttpMessageNotReadableException ignored ->
                "Request body is missing or malformed";
            default -> ex.getMessage() != null ? ex.getMessage() : "Malformed request";
        };
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiError> handleMethodNotAllowed(HttpRequestMethodNotSupportedException ex) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
            .body(ApiError.of("METHOD_NOT_ALLOWED",
                "%s is not supported on this endpoint".formatted(ex.getMethod()), traceId()));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiError> handleNoResource(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ApiError.of("NOT_FOUND", "No endpoint matches this path", traceId()));
    }

    /**
     * A unique/foreign-key violation is a conflict with existing data, not a server fault — a
     * duplicate vendor code or a second open till should read as 409 and be retried by the user
     * with different input. The database message is deliberately not echoed: it names tables,
     * columns and constraints.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException ex) {
        log.warn("[{}] Data integrity violation: {}", traceId(), ex.getMostSpecificCause().getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiError.of("CONFLICT", "This conflicts with existing data", traceId()));
    }

    /**
     * Lost optimistic-lock races. Two cashiers settling the same order, two counts posting against
     * the same ingredient: the loser should be told to retry, not shown a 500.
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimisticLock(OptimisticLockingFailureException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiError.of("CONCURRENT_MODIFICATION",
                "This record changed while you were editing it — reload and try again", traceId()));
    }

    @ExceptionHandler(RestaurantOsException.class)
    public ResponseEntity<ApiError> handleBase(RestaurantOsException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        // The response deliberately says nothing useful (it is client-facing), so the stack trace
        // MUST be logged here — otherwise an unexpected 500 leaves no trace anywhere and is
        // undiagnosable. Correlate with the traceId returned to the caller.
        String traceId = traceId();
        log.error("[{}] Unhandled exception: {}", traceId, ex.toString(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ApiError.of("INTERNAL_ERROR", "An unexpected error occurred", traceId));
    }
}
