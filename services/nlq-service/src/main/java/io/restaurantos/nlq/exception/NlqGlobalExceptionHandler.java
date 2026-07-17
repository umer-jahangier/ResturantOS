package io.restaurantos.nlq.exception;

import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import io.restaurantos.nlq.execution.NlqRowCapExceededException;
import io.restaurantos.nlq.execution.NlqTimeoutException;
import io.restaurantos.nlq.quota.QuotaExceededException;
import io.restaurantos.nlq.quota.QuotaServiceUnavailableException;
import io.restaurantos.nlq.validation.NlqRejectedException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

/**
 * Maps every NLQ-specific exception to the HTTP status pinned in 12-07-SUMMARY.md for 12-09's
 * frontend to consume. Never echoes the offending SQL or a raw exception message that could leak
 * internals — {@link NlqRejectedException#getMessage()} is already a safe generic string by
 * construction (12-04).
 */
@RestControllerAdvice
public class NlqGlobalExceptionHandler {

    @ExceptionHandler(NlqRejectedException.class)
    public ResponseEntity<ProblemDetail> handleRejected(NlqRejectedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("QUERY_REJECTED");
        pd.setType(URI.create("urn:restaurantos:nlq:rejected"));
        pd.setProperty("code", ex.code().name());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }

    @ExceptionHandler(QuotaExceededException.class)
    public ResponseEntity<ProblemDetail> handleQuotaExceeded(QuotaExceededException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage());
        pd.setTitle("QUOTA_EXCEEDED");
        pd.setType(URI.create("urn:restaurantos:nlq:quota-exceeded"));
        pd.setProperty("code", "QUOTA_EXCEEDED_" + ex.quota().name());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(pd);
    }

    @ExceptionHandler(QuotaServiceUnavailableException.class)
    public ResponseEntity<ProblemDetail> handleQuotaServiceUnavailable(QuotaServiceUnavailableException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "NLQ quota service is temporarily unavailable");
        pd.setTitle("QUOTA_SERVICE_UNAVAILABLE");
        pd.setType(URI.create("urn:restaurantos:nlq:quota-service-unavailable"));
        pd.setProperty("code", "QUOTA_SERVICE_UNAVAILABLE");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    @ExceptionHandler(ClaudeUnavailableException.class)
    public ResponseEntity<ProblemDetail> handleClaudeUnavailable(ClaudeUnavailableException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "The NLQ SQL-generation service is temporarily unavailable");
        pd.setTitle("CLAUDE_UNAVAILABLE");
        pd.setType(URI.create("urn:restaurantos:nlq:claude-unavailable"));
        pd.setProperty("code", "CLAUDE_UNAVAILABLE");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    @ExceptionHandler(NlqTimeoutException.class)
    public ResponseEntity<ProblemDetail> handleTimeout(NlqTimeoutException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("QUERY_TIMEOUT");
        pd.setType(URI.create("urn:restaurantos:nlq:query-timeout"));
        pd.setProperty("code", "QUERY_TIMEOUT");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }

    @ExceptionHandler(NlqRowCapExceededException.class)
    public ResponseEntity<ProblemDetail> handleRowCapExceeded(NlqRowCapExceededException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("ROW_CAP_EXCEEDED");
        pd.setType(URI.create("urn:restaurantos:nlq:row-cap-exceeded"));
        pd.setProperty("code", "ROW_CAP_EXCEEDED");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }
}
