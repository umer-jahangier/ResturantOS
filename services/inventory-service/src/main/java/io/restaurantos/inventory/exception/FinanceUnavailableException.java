package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * finance-service could not be reached (or answered with an error) while resolving GL accounts.
 * Maps to HTTP 503 {@code FINANCE_UNAVAILABLE} via {@code InventoryExceptionHandler}.
 *
 * <p>Exists so the GL-account seam can fail CLOSED. Treating an unreachable finance-service as
 * "that account didn't match anything" would let a category save with an unvalidated account code
 * during an outage, which is exactly the silent bad data the validation was added to prevent — and
 * it would not surface until Phase 9 posted against it. A 503 is honest, retryable, and keeps the
 * user's input in the form.
 */
public class FinanceUnavailableException extends RestaurantOsException {
    public FinanceUnavailableException(Throwable cause) {
        super("FINANCE_UNAVAILABLE",
                "Couldn't reach the accounting service to check GL accounts. Try again in a moment.");
        initCause(cause);
    }
}
