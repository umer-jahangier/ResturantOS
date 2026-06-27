package io.restaurantos.finance.exception;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Map;

@RestControllerAdvice
public class FinanceGlobalExceptionHandler {

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> handleDataIntegrity(DataIntegrityViolationException ex) {
        String msg = ex.getMostSpecificCause().getMessage();
        if (msg != null && (msg.contains("JE_UNBALANCED") || msg.contains("not balanced"))) {
            return ResponseEntity.unprocessableEntity()
                    .body(errorBody("JE_UNBALANCED",
                            "Journal entry lines are not balanced (DR \u2260 CR)"));
        }
        return ResponseEntity.unprocessableEntity()
                .body(errorBody("DATA_INTEGRITY_ERROR", "Data integrity violation: " + msg));
    }

    @ExceptionHandler(PeriodLockedException.class)
    public ResponseEntity<Map<String, Object>> handlePeriodLocked(PeriodLockedException ex) {
        return ResponseEntity.status(423)
                .body(errorBody("PERIOD_LOCKED",
                        "Period " + ex.getPeriodId() + " is locked for posting"));
    }

    @ExceptionHandler(TotpRequiredException.class)
    public ResponseEntity<Map<String, Object>> handleTotpRequired(TotpRequiredException ex) {
        return ResponseEntity.status(403)
                .body(errorBody("TOTP_REQUIRED", ex.getMessage()));
    }

    @ExceptionHandler(PeriodAlreadyLockedException.class)
    public ResponseEntity<Map<String, Object>> handlePeriodAlreadyLocked(PeriodAlreadyLockedException ex) {
        return ResponseEntity.status(409)
                .body(errorBody("PERIOD_ALREADY_LOCKED", ex.getMessage()));
    }

    @ExceptionHandler(PeriodPreCheckException.class)
    public ResponseEntity<Map<String, Object>> handlePeriodPreCheck(PeriodPreCheckException ex) {
        return ResponseEntity.status(409)
                .body(errorBody("PERIOD_PRE_CHECK_FAILED", ex.getMessage()));
    }

    @ExceptionHandler(PeriodNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handlePeriodNotFound(PeriodNotFoundException ex) {
        return ResponseEntity.notFound().build();
    }

    @ExceptionHandler(JeAlreadyPostedException.class)
    public ResponseEntity<Map<String, Object>> handleAlreadyPosted(JeAlreadyPostedException ex) {
        return ResponseEntity.status(409)
                .body(errorBody("JE_ALREADY_POSTED", "Journal entry is already posted"));
    }

    @ExceptionHandler(JeNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleJeNotFound(JeNotFoundException ex) {
        return ResponseEntity.notFound().build();
    }

    @ExceptionHandler(AccountNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleAccountNotFound(AccountNotFoundException ex) {
        return ResponseEntity.notFound().build();
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalState(IllegalStateException ex) {
        return ResponseEntity.badRequest()
                .body(errorBody("INVALID_OPERATION", ex.getMessage()));
    }

    private Map<String, Object> errorBody(String code, String message) {
        return Map.of(
                "code", code,
                "message", message,
                "timestamp", Instant.now().toString()
        );
    }
}
