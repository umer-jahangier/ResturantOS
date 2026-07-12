package io.restaurantos.purchasing.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Thrown when a user who already approved a tier of a multi-tier PO attempts to
 * approve again — a 2-tier PO requires two DISTINCT approvers (10-07 Task 3).
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class DuplicateApproverException extends RuntimeException {
    public DuplicateApproverException() {
        super("DUPLICATE_APPROVER");
    }
}
