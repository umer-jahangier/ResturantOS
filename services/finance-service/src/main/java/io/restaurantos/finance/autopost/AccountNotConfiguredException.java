package io.restaurantos.finance.autopost;

import java.util.List;

public class AccountNotConfiguredException extends RuntimeException {

    public AccountNotConfiguredException(String systemTag) {
        super("No chart of accounts entry for system_tag: " + systemTag);
    }

    public AccountNotConfiguredException(String message, String accountCode) {
        super(message + " (code=" + accountCode + ")");
    }

    /**
     * More than one active account carries the tag. Refusing beats picking one: the choice would
     * otherwise fall out of Postgres row order and change between runs (see {@link AccountResolver}).
     */
    static AccountNotConfiguredException ambiguous(String systemTag, List<String> codes) {
        return new AccountNotConfiguredException(
                "Ambiguous system_tag resolves to " + codes
                        + " — a posting account must be unique per tenant", systemTag);
    }
}
