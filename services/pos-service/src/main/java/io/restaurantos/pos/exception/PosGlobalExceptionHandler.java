package io.restaurantos.pos.exception;

import io.restaurantos.shared.exception.IdempotencyConflictException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.PeriodLockedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

@RestControllerAdvice
public class PosGlobalExceptionHandler {

    @ExceptionHandler(StateInvalidException.class)
    public ResponseEntity<ProblemDetail> handleStateInvalid(StateInvalidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("STATE_INVALID");
        pd.setType(URI.create("urn:restaurantos:pos:state-invalid"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler({PosExceptions.OrderNotFoundException.class, ResourceNotFoundException.class})
    public ResponseEntity<ProblemDetail> handleNotFound(RuntimeException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("NOT_FOUND");
        pd.setType(URI.create("urn:restaurantos:pos:not-found"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
    }

    @ExceptionHandler(PosExceptions.ZeroValueOrderException.class)
    public ResponseEntity<ProblemDetail> handleZeroValue(PosExceptions.ZeroValueOrderException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("ZERO_VALUE_ORDER");
        pd.setType(URI.create("urn:restaurantos:pos:zero-value-order"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ProblemDetail> handleIdempotency(IdempotencyConflictException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("IDEMPOTENCY_CONFLICT");
        pd.setType(URI.create("urn:restaurantos:pos:idempotency-conflict"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler(PermissionDeniedException.class)
    public ResponseEntity<ProblemDetail> handlePermission(PermissionDeniedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, ex.getMessage());
        pd.setTitle("FORBIDDEN");
        pd.setType(URI.create("urn:restaurantos:pos:forbidden"));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(PeriodLockedException.class)
    public ResponseEntity<ProblemDetail> handlePeriodLocked(PeriodLockedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.LOCKED, ex.getMessage());
        pd.setTitle("PERIOD_LOCKED");
        pd.setType(URI.create("urn:restaurantos:pos:period-locked"));
        return ResponseEntity.status(HttpStatus.LOCKED).body(pd);
    }
}
