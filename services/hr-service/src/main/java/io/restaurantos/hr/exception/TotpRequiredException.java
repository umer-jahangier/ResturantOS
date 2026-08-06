package io.restaurantos.hr.exception;

/**
 * Raised when a step-up-gated operation (payroll approval) is attempted without TOTP verification.
 *
 * <p>The HTTP mapping lives in {@link HrExceptionHandler}, not in a {@code @ResponseStatus} here:
 * the shared catch-all advice resolves before {@code ResponseStatusExceptionResolver}, so an
 * annotation on this class is silently ignored.
 */
public class TotpRequiredException extends RuntimeException {

    public TotpRequiredException() {
        super("TOTP step-up verification is required to approve a payroll run");
    }
}
