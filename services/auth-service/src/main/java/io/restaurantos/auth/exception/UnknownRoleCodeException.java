package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A caller supplied a role code that is not in the {@code roles} catalog (D-13).
 *
 * <p>Maps to 400 via {@code GlobalExceptionHandler#handleBase}, and deliberately so: the caller
 * asserted a role that does not exist, so this is a client error and no row is written.
 *
 * <p>Why it is worth an exception at all. Before this, an arbitrary string persisted into
 * {@code user_branch_roles.role_code} without complaint. {@code role_permissions} then has no rows
 * for it, so {@code PermissionResolver} resolves the assignment to an EMPTY permission list and the
 * user logs in successfully holding nothing. To the user that is a working login into a product
 * with every screen missing; to the administrator who made the typo it is a role that was assigned.
 * Nothing anywhere reports an error. Naming the rejected code in the message is the difference
 * between "your request was invalid" and "you wrote OWNERR".
 */
public class UnknownRoleCodeException extends RestaurantOsException {

    public UnknownRoleCodeException(String roleCode) {
        super("UNKNOWN_ROLE_CODE", "Unknown role code: " + roleCode);
    }
}
