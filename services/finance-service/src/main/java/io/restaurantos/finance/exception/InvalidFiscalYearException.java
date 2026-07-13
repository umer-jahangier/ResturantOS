package io.restaurantos.finance.exception;

public class InvalidFiscalYearException extends RuntimeException {

    private final int fiscalYear;

    public InvalidFiscalYearException(int fiscalYear) {
        super("Invalid fiscal year: " + fiscalYear);
        this.fiscalYear = fiscalYear;
    }

    public int getFiscalYear() {
        return fiscalYear;
    }
}
