package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

/**
 * What a user's ringable menu categories should now be, at one branch (Program A).
 *
 * <p>A REPLACE, not an add. The admin UI edits a checkbox list and sends what the list now says, so
 * a full replacement is both the honest model of the interaction and trivially idempotent — sending
 * it twice cannot accumulate anything.
 *
 * <p>{@code branchId} is required and deliberately not defaultable. A person can run the bar at one
 * site and the whole floor at another; guessing a branch here would store a row that means something
 * different from what the administrator was looking at.
 *
 * <p>{@code categoryIds} may be empty, and that is not a corner case — it is how an administrator
 * returns a user to ringing the WHOLE menu, it is the state every user in the product is in today,
 * and it must stay expressible. Do not "helpfully" reject it.
 *
 * <p>There is deliberately no select-all affordance implied here. 51 categories exist on the live
 * tenant, and a user assigned all of them would carry roughly 1.9 KB of UUIDs in every request
 * header for the same effect that assigning NOTHING achieves at zero bytes. Unrestricted is the
 * empty list, and the admin screen should present it that way.
 */
public record MenuCategoryAssignmentRequest(
    @NotNull(message = "branchId is required — a menu scope is only meaningful within a branch")
    UUID branchId,

    @NotNull(message = "categoryIds is required; send an empty list to clear the assignment")
    List<UUID> categoryIds
) {}
