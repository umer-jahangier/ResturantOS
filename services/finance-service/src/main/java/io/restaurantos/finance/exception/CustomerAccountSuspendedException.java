package io.restaurantos.finance.exception;

import java.util.UUID;

public class CustomerAccountSuspendedException extends RuntimeException {

    public CustomerAccountSuspendedException(UUID id) {
        super("Customer account is suspended: " + id);
    }
}
