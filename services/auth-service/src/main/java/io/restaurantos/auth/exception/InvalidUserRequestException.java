package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A user-lifecycle request the caller can fix by changing it — 400 via
 * {@code GlobalExceptionHandler#handleBase}.
 *
 * <p>Distinct from {@code StateInvalidException}, which this service uses for a genuine conflict
 * with data that already exists (a duplicate address) and which maps to <b>409</b>. Both were
 * candidates for "roleCode without branchId", and the distinction matters to a client: a 409 says
 * "try again with something else and it may work", a 400 says "this request can never succeed as
 * written". A role with no branch is the second kind.
 */
public class InvalidUserRequestException extends RestaurantOsException {

    public InvalidUserRequestException(String message) {
        super("VALIDATION_FAILED", message);
    }
}
