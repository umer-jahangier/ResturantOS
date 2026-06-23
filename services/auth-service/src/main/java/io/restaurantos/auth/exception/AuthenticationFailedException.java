package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

public class AuthenticationFailedException extends RestaurantOsException {
    public AuthenticationFailedException(String message) {
        super("UNAUTHENTICATED", message);
    }
}
