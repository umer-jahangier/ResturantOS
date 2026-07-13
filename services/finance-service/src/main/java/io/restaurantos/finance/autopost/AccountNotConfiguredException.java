package io.restaurantos.finance.autopost;

public class AccountNotConfiguredException extends RuntimeException {

    public AccountNotConfiguredException(String systemTag) {
        super("No chart of accounts entry for system_tag: " + systemTag);
    }

    public AccountNotConfiguredException(String message, String accountCode) {
        super(message + " (code=" + accountCode + ")");
    }
}
