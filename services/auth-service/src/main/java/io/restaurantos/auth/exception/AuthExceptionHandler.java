package io.restaurantos.auth.exception;

import io.restaurantos.auth.exception.AuthenticationFailedException;
import io.restaurantos.auth.exception.TotpRequiredException;
import io.restaurantos.auth.exception.BranchSwitchDeniedException;
import io.restaurantos.auth.exception.PasswordReuseException;
import io.restaurantos.shared.api.ApiError;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class AuthExceptionHandler {

    @ExceptionHandler(AuthenticationFailedException.class)
    public ResponseEntity<ApiError> handleAuth(AuthenticationFailedException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ApiError.of("UNAUTHENTICATED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(AccountLockedException.class)
    public ResponseEntity<ApiError> handleLocked(AccountLockedException ex) {
        return ResponseEntity.status(HttpStatus.LOCKED)
            .body(ApiError.of("ACCOUNT_LOCKED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(TotpRequiredException.class)
    public ResponseEntity<ApiError> handleTotpRequired(TotpRequiredException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ApiError.of("TOTP_REQUIRED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(BranchSwitchDeniedException.class)
    public ResponseEntity<ApiError> handleBranchSwitch(BranchSwitchDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiError.of("BRANCH_ACCESS_DENIED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(PasswordReuseException.class)
    public ResponseEntity<ApiError> handlePasswordReuse(PasswordReuseException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError.of("PASSWORD_REUSE", ex.getMessage(), traceId()));
    }

    private String traceId() {
        String t = MDC.get("traceId");
        return t != null ? t : "unknown";
    }
}
