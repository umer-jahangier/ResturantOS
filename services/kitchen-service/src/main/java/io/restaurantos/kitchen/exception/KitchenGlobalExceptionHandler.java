package io.restaurantos.kitchen.exception;

import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

@RestControllerAdvice
public class KitchenGlobalExceptionHandler {

    @ExceptionHandler(PermissionDeniedException.class)
    public ResponseEntity<ProblemDetail> handlePermissionDenied(PermissionDeniedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, ex.getMessage());
        pd.setTitle("FORBIDDEN");
        pd.setType(URI.create("urn:restaurantos:kds:forbidden"));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ProblemDetail> handleNotFound(ResourceNotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("NOT_FOUND");
        pd.setType(URI.create("urn:restaurantos:kds:not-found"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
    }

    /**
     * The branch's time zone could not be established, so the start of today's trading day is not
     * known (F17).
     *
     * <p>503 and not 500: nothing is broken here, a dependency is unavailable, and the honest thing
     * to tell a cook is "try again" rather than "something went wrong". The message names what to do
     * and states, in so many words, that nothing was cleared — because a destructive action that
     * fails silently ambiguously is worse than one that fails loudly.
     */
    @ExceptionHandler(io.restaurantos.kitchen.service.BranchBusinessDay.BranchZoneUnknownException.class)
    public ResponseEntity<ProblemDetail> handleZoneUnknown(
            io.restaurantos.kitchen.service.BranchBusinessDay.BranchZoneUnknownException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, ex.getMessage());
        pd.setTitle("BRANCH_TIMEZONE_UNKNOWN");
        pd.setType(URI.create("urn:restaurantos:kds:branch-timezone-unknown"));
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    @ExceptionHandler(StateInvalidException.class)
    public ResponseEntity<ProblemDetail> handleStateInvalid(StateInvalidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("STATE_INVALID");
        pd.setType(URI.create("urn:restaurantos:kds:state-invalid"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }
}
