package io.restaurantos.finance.exception;

public class AccountNotFoundException extends RuntimeException {
    private final String code;

    public AccountNotFoundException(String code) {
        super("Account not found: " + code);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
