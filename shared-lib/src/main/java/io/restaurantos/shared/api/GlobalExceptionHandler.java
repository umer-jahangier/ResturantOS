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

    /**
     * Emits the exception's own code rather than the literal {@code "STATE_INVALID"}.
     *
     * <p>Behaviour-preserving: the one-argument {@link StateInvalidException} constructor sets the
     * code to {@code STATE_INVALID}, and all 42 pre-existing throw sites use it, so every existing
     * response is byte-identical. Only the two-argument constructor introduced in 35-01 differs,
     * which is what lets payroll distinguish "wrong state" from "no branch" (D-35-03).
     */
    @ExceptionHandler(StateInvalidException.class)
    public ResponseEntity<ApiError> handleState(StateInvalidException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
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
            .map(fe -> new ApiError.FieldError(toClientPath(fe.getField()), fe.getDefaultMessage())).toList();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError.of("VALIDATION_FAILED", "Request validation failed", details, traceId()));
    }

    /**
     * Spring writes an indexed path as {@code slabs[0].ratePct}; the web client binds
     * {@code slabs.0.ratePct}. Same path, two spellings, and the difference is not cosmetic.
     *
     * <p>The client's binder ({@code frontend/lib/forms/server-field-errors.ts}) splits a path on
     * {@code "."} and walks the form's values, exactly as {@code createZodResolver} does when it
     * reports a client-side error for the same input. Given {@code slabs[0].ratePct} the first
     * segment is the literal string {@code "slabs[0]"}, which matches no key, so the message is
     * treated as naming a field this form does not have and is demoted to a form-level error above
     * the table — which for a six-row slab editor is precisely the "one sentence and no idea which
     * row" experience this phase exists to remove. Every flat field path is unaffected, because it
     * contains no bracket.
     *
     * <p>Normalising here rather than in each client means the API has ONE documented shape for an
     * indexed path, and it is the shape react-hook-form and the app's own resolver already use.
     */
    private static String toClientPath(String springFieldPath) {
        if (springFieldPath == null || springFieldPath.indexOf('[') < 0) {
            return springFieldPath;
        }
        return springFieldPath.replace("[", ".").replace("]", "");
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

    /**
     * A domain rule refused the request and named the input to blame (D-35-03).
     *
     * <p>422, not 400: 400 stays reserved for bean validation, so a client can tell a malformed
     * request from a well-formed one refused by a rule. The body reuses the four-argument
     * {@link ApiError} factory that {@link #handleValidation} already uses, because the web client
     * parses {@code details[]} into {@code fieldErrors} today — a second envelope shape would need
     * a second parser on every screen.
     *
     * <p>Declared above {@link #handleBase} for readability. Spring resolves by exception-type
     * depth rather than declaration order, so the subclass would win regardless; the placement is
     * for the next person reading the file, not for the resolver.
     */
    @ExceptionHandler(FieldValidationException.class)
    public ResponseEntity<ApiError> handleFieldValidation(FieldValidationException ex) {
        List<ApiError.FieldError> details = ex.getViolations().stream()
            .map(v -> new ApiError.FieldError(v.field(), v.instruction())).toList();
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
            .body(ApiError.of(ex.getCode(), ex.getMessage(), details, traceId()));
    }

    /**
     * A value collided with an existing row and the service knows which input it was.
     *
     * <p>Same 409 as {@link #handleDataIntegrity}, but with a field path: this is raised by a
     * service that checked before writing, so unlike the driver-level violation it can say which
     * box the user must change. See {@link DuplicateValueException} for why disclosing the
     * collision is acceptable.
     */
    @ExceptionHandler(DuplicateValueException.class)
    public ResponseEntity<ApiError> handleDuplicateValue(DuplicateValueException ex) {
        List<ApiError.FieldError> details = List.of(new ApiError.FieldError(ex.getField(), ex.getMessage()));
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiError.of("DUPLICATE_VALUE", ex.getMessage(), details, traceId()));
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
