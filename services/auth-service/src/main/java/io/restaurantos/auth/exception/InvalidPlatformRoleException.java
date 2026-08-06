package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A platform role was asserted that {@code chk_platform_users_role} does not permit
 * (010-create-platform-tables.xml:108-109), so no platform user could ever hold it.
 *
 * <p>Maps to 400 via {@code GlobalExceptionHandler#handleBase}. Deliberately a client error, not a
 * server error: the caller asserted something that cannot be true, and the signer is never reached.
 */
public class InvalidPlatformRoleException extends RestaurantOsException {

    public InvalidPlatformRoleException(String role) {
        super("INVALID_PLATFORM_ROLE", "Unknown platform role: " + role);
    }
}
