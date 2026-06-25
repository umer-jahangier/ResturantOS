package io.restaurantos.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

public final class BranchDtos {

    private BranchDtos() {}

    public record CreateBranchRequest(
        @NotBlank @Size(max = 150) String name,
        boolean isHq,
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
}
