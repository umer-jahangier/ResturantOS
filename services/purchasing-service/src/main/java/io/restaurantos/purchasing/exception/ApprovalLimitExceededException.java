package io.restaurantos.purchasing.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(HttpStatus.FORBIDDEN)
public class ApprovalLimitExceededException extends RuntimeException {
    public ApprovalLimitExceededException() {
        super("APPROVAL_LIMIT_EXCEEDED");
    }
}
