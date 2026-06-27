package io.restaurantos.finance.exception;

public class PeriodPreCheckException extends RuntimeException {

    public PeriodPreCheckException(String detail) {
        super("Period pre-close check failed: " + detail);
    }
}
