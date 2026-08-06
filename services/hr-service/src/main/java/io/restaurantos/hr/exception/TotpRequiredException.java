package io.restaurantos.hr.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** Raised when a step-up-gated operation (payroll approval) is attempted without TOTP verification. */
@ResponseStatus(HttpStatus.UNAUTHORIZED)
public class TotpRequiredException extends RuntimeException {

    public TotpRequiredException() {
        super("TOTP step-up verification is required to approve a payroll run");
    }
}
