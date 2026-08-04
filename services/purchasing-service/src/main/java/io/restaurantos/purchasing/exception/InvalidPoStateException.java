package io.restaurantos.purchasing.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * The purchase order is not in a state where the requested transition is legal — approving one
 * twice, receiving against one that was never sent.
 *
 * <p>The annotation below is documentation only. Spring resolves an {@code @ExceptionHandler} by
 * exception hierarchy BEFORE it considers {@code @ResponseStatus}, and shared-lib's
 * {@code GlobalExceptionHandler} declares {@code @ExceptionHandler(Exception.class)} — so this
 * surfaced as 500 until {@code PurchasingExceptionHandler} claimed it explicitly. That handler is
 * what a client actually sees.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class InvalidPoStateException extends RuntimeException {
    public InvalidPoStateException(String message) {
        super(message);
    }
}
