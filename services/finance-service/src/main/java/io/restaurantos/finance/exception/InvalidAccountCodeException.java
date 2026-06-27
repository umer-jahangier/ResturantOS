package io.restaurantos.finance.exception;

public class InvalidAccountCodeException extends RuntimeException {

    private final String accountCode;

    public InvalidAccountCodeException(String accountCode) {
        super("Invalid or inactive account code: " + accountCode);
        this.accountCode = accountCode;
    }

    public String getAccountCode() {
        return accountCode;
    }
}
