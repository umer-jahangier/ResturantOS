package io.restaurantos.finance.exception;

public class TotpRequiredException extends RuntimeException {

    public TotpRequiredException() {
        super("TOTP verification is required for this operation");
    }
}
