package io.restaurantos.purchasing.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Thrown when a new price's {@code effectiveFrom} is at or before the currently-open row's own
 * {@code effectiveFrom} — history must never be interleaved backwards, or a past invoice match
 * could be silently changed by a later, earlier-dated price.
 */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class BackdatedPriceException extends RuntimeException {
    public BackdatedPriceException() {
        super("BACKDATED_PRICE");
    }
}
