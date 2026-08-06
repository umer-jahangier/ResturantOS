package io.restaurantos.user.service;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A request to the public user surface that no retry can fix — 400 {@code VALIDATION_FAILED}.
 *
 * <p>Distinct from a 409: a duplicate email conflicts with data that exists and the caller can
 * resolve it by choosing another address, whereas this says the request itself is not one this
 * endpoint accepts. Mirrors the code auth-service uses for the same class of refusal, so the public
 * and internal surfaces do not disagree about what a bad request is called.
 */
public class InvalidUserRequestException extends RestaurantOsException {
    public InvalidUserRequestException(String message) {
        super("VALIDATION_FAILED", message);
    }
}
