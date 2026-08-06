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

import java.util.List;

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

    @ExceptionHandler(TotpEnrollmentRequiredException.class)
    public ResponseEntity<ApiError> handleTotpEnrollment(TotpEnrollmentRequiredException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ApiError.of("TOTP_ENROLLMENT_REQUIRED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(TotpAlreadyEnrolledException.class)
    public ResponseEntity<ApiError> handleTotpAlreadyEnrolled(TotpAlreadyEnrolledException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiError.of("TOTP_ALREADY_ENROLLED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(BranchSwitchDeniedException.class)
    public ResponseEntity<ApiError> handleBranchSwitch(BranchSwitchDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiError.of("BRANCH_ACCESS_DENIED", ex.getMessage(), traceId()));
    }

    /**
     * The forced-change refusal (D-17).
     *
     * <p><b>403, not 401.</b> The credential was accepted; what is being refused is the session, on
     * account of the state the account is in. A client that retries a 401 by re-prompting for the
     * password would loop forever here. It is also what keeps this gate distinguishable from the
     * OTHER gate a fresh account can hit — {@code 401 TOTP_ENROLLMENT_REQUIRED} — which an account
     * holding {@code rbac.manage} with no enrolled factor will meet on its NEXT login, once the
     * password has been changed. Two gates, two codes, two statuses, in that order.
     *
     * <p><b>The change token travels in {@code details}</b> rather than in a bespoke body, so every
     * client keeps one error parser instead of two, and so the refusal cannot be mistaken for the
     * success-shaped {@code LoginResponse}. That response type was deliberately left untouched: a
     * client that reads a token out of a refusal is one refactor away from reading the wrong one.
     *
     * <p>The token is a credential, so this is the ONLY place it is ever written: it is not logged,
     * not persisted in raw form, and not put in any event. It reveals nothing on its own — it is
     * useless without the current password — and it is spent by the first attempt to use it.
     */
    @ExceptionHandler(PasswordChangeRequiredException.class)
    public ResponseEntity<ApiError> handlePasswordChangeRequired(PasswordChangeRequiredException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiError.of("PASSWORD_CHANGE_REQUIRED", ex.getMessage(),
                List.of(new ApiError.FieldError("changeToken", ex.changeToken()),
                        new ApiError.FieldError("expiresAt", ex.expiresAt().toString())),
                traceId()));
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
