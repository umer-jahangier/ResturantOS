package io.restaurantos.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

public final class BranchDtos {

    private BranchDtos() {}

    /**
     * A new branch. Only {@code name} is required — everything else is optional, including
     * {@code isHq}.
     *
     * <h3>Why {@code isHq} is a {@code Boolean} and not a {@code boolean}</h3>
     *
     * <p>It was a primitive, and on a RECORD that made it mandatory in a way nothing said out loud.
     * Jackson builds a record through its canonical constructor, so an absent key is passed as
     * {@code null}, unboxing it throws, and Spring answers
     * {@code 400 BAD_REQUEST — "Request body is missing or malformed"} — a message about the whole
     * body, naming no field, for a request whose body is perfectly well-formed JSON.
     *
     * <p>Measured live through the gateway as OWNER on 2026-08-12, two requests differing by one
     * key:
     *
     * <pre>
     *   POST {"name":"A","isHq":false,"address":"1 Road","timezone":"Asia/Karachi"} → 201
     *   POST {"name":"B",              "address":"1 Road","timezone":"Asia/Karachi"} → 400
     * </pre>
     *
     * <p>That is a trap for every client, and it caught the first one: the Branches screen
     * deliberately does not offer an HQ control — which branch is head office is settled when the
     * tenant is provisioned, and a second HQ is not a state this product has any meaning for — so
     * it omitted the key and every attempt to add a branch failed with a message pointing at the
     * body rather than at the missing boolean.
     *
     * <p>Absent now means {@code false}, which is what "is this the head office?" unstated should
     * always have meant.
     */
    public record CreateBranchRequest(
        @NotBlank @Size(max = 150) String name,
        Boolean isHq,
        String address,
        String phone,
        String email,
        String timezone,
        String currencyConfig,
        String receiptConfig,
        LocalDate openedOn
    ) {}

    public record UpdateBranchRequest(
        @Size(max = 150) String name,
        Boolean isActive,
        String address,
        String phone,
        String email,
        String timezone,
        String currencyConfig,
        String receiptConfig,
        LocalDate openedOn
    ) {}

    public record BranchResponse(
        UUID id,
        UUID tenantId,
        String name,
        boolean isHq,
        boolean isActive,
        String address,
        String fbrStrn,
        String ntn,
        String phone,
        String email,
        String timezone,
        String currencyConfig,
        String receiptConfig,
        LocalDate openedOn
    ) {}

    /**
     * What a user's stations should now be, at one branch (28-01, D-28-02).
     *
     * <p>A REPLACE: the admin UI edits a checkbox list and sends what the list now says. An empty
     * {@code stationCodes} clears the branch and returns the user to seeing every station there —
     * which is the state every user in this product is in today, so it must stay expressible.
     */
    public record StationAssignmentRequest(
        @NotNull UUID branchId,
        @NotNull java.util.List<String> stationCodes
    ) {}

    /** A user's active station codes at one branch. A branch with none simply does not appear. */
    public record StationAssignment(UUID branchId, java.util.List<String> stationCodes) {}

    /** Used by the provisioning saga (FD-1 step 4) via POST /internal/users/branches. */
    public record InternalCreateBranchRequest(
        @NotNull UUID tenantId,
        @NotBlank @Size(max = 150) String name,
        boolean isHq
    ) {}

    /** Response from POST /internal/users/branches — the created branch id for the saga. */
    public record InternalCreateBranchResponse(UUID branchId) {}

    /** Role assignment/revocation request for /api/v1/users/{userId}/branch-roles. */
    public record BranchRoleRequest(
        @NotNull UUID branchId,
        @NotBlank String roleCode,
        Long approvalLimitPaisa
    ) {}

    /** Active branch-role row from auth-service (internal + Feign). */
    public record BranchRoleAssignment(
        UUID branchId,
        String roleCode
    ) {}

    /** Branches the current user is assigned to (GET /api/v1/branches/mine). */
    public record MineBranchResponse(
        UUID id,
        String name,
        boolean isHq,
        String roleCode
    ) {}
}
