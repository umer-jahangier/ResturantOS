package io.restaurantos.purchasing.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown when a new price's {@code effectiveFrom} is at or before the currently-open row's own
 * {@code effectiveFrom} — history must never be interleaved backwards, or a past invoice match
 * could be silently changed by a later, earlier-dated price. Extends {@link RestaurantOsException}
 * (not a bare {@code @ResponseStatus} runtime exception) so {@code GlobalExceptionHandler}'s
 * {@code @ExceptionHandler(RestaurantOsException.class)} resolves it to 400 — a plain {@code
 * RuntimeException} would instead fall through to the shared catch-all 500 handler, since Spring
 * picks the exception-hierarchy-closest {@code @ExceptionHandler} method, not annotation-based
 * {@code @ResponseStatus} resolution, whenever a {@code @RestControllerAdvice} already declares a
 * broader handler.
 */
public class BackdatedPriceException extends RestaurantOsException {
    public BackdatedPriceException() {
        super("BACKDATED_PRICE",
                "The new price's effectiveFrom must be after the currently open price's effectiveFrom");
    }
}
