package io.restaurantos.auth.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * The acting user tried to grant a role that carries permissions they do not themselves hold.
 *
 * <p>This is the write-side half of the ceiling 13-07 built into {@code GET /api/v1/roles}. The
 * catalog withheld the role; the write path did not check at all, and a TENANT_ADMIN assigning
 * OWNER was answered <b>200</b> — reproduced live by
 * {@code scripts/e2e/phase13-role-catalog-e2e.sh} before this existed. The account so created holds
 * {@code rbac.manage}, the umbrella permission 13-02 split the tenant-administration authority
 * precisely in order to withhold, and the assigner can then log in as it.
 *
 * <p><b>The message names the role and a COUNT, never the permission codes.</b> Naming them
 * republishes exactly what the ceiling withholds, which is the same reasoning 13-07 recorded for
 * reporting withheld roles as a count rather than as names. The count is what turns "the platform
 * refused for no reason" into an answer, and its recipient is already an administrator of this
 * tenant.
 */
public class RoleCeilingExceededException extends RestaurantOsException {

    public RoleCeilingExceededException(String roleCode, int permissionsBeyondCeiling) {
        super("ROLE_CEILING_EXCEEDED",
            "You cannot assign the role " + roleCode + ": it grants "
                + permissionsBeyondCeiling + " permission(s) you do not hold yourself");
    }

    public RoleCeilingExceededException(String message) {
        super("ROLE_CEILING_EXCEEDED", message);
    }
}
