package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

public class AccountLockedException extends RestaurantOsException {
    public AccountLockedException(String message) {
        super("ACCOUNT_LOCKED", message);
    }
}
