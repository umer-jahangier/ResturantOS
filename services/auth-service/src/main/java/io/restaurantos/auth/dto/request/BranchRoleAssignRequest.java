package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record BranchRoleAssignRequest(
    @NotNull UUID branchId,
    @NotNull String roleCode,
    Long approvalLimitPaisa
) {}
