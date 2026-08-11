package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

/**
 * What a user's stations should now be, at one branch (D-28-02).
 *
 * <p>This is a REPLACE, not an add. The admin UI edits a checkbox list and sends what the list now
 * says, so a full replacement is both the honest model of the interaction and trivially idempotent
 * — sending it twice cannot accumulate anything.
 *
 * <p>{@code branchId} is required and deliberately not defaultable. A station code is only unique
 * within a (tenant, branch), so a branch-less assignment is ambiguous by construction; guessing a
 * branch here would store a row that means something different from what the administrator was
 * looking at.
 *
 * <p>{@code stationCodes} may be empty. That is how an administrator returns a user to seeing every
 * station in their branch, and it must stay expressible — it is the state every user in the product
 * is in today.
 */
public record StationAssignmentRequest(
    @NotNull(message = "branchId is required — a station code is only meaningful within a branch")
    UUID branchId,

    @NotNull(message = "stationCodes is required; send an empty list to clear the assignment")
    List<String> stationCodes
) {}
