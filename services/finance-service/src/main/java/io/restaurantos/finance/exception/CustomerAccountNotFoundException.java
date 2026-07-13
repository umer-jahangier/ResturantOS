package io.restaurantos.finance.exception;

import java.util.UUID;

public class CustomerAccountNotFoundException extends RuntimeException {

    public CustomerAccountNotFoundException(UUID id) {
        super("Customer account not found: " + id);
    }
}
