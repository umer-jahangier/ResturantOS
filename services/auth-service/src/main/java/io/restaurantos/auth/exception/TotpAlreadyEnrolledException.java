package io.restaurantos.auth.exception;

/** Raised when the unauthenticated bootstrap is used on an account that already has a secret. */
public class TotpAlreadyEnrolledException extends RuntimeException {
    public TotpAlreadyEnrolledException(String message) {
        super(message);
    }
}
