package io.restaurantos.shared.api;

import io.restaurantos.shared.exception.*;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private String traceId() { String t = MDC.get("traceId"); return t != null ? t : "unknown"; }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(PermissionDeniedException.class)
    public ResponseEntity<ApiError> handlePermission(PermissionDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiError.of("PERMISSION_DENIED", ex.getMessage(), traceId()));
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

    @ExceptionHandler(RestaurantOsException.class)
    public ResponseEntity<ApiError> handleBase(RestaurantOsException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ApiError.of("INTERNAL_ERROR", "An unexpected error occurred", traceId()));
    }
}
