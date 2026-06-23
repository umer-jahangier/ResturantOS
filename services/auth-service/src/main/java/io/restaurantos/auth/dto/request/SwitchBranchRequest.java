package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record SwitchBranchRequest(
    @NotNull UUID branchId
) {}
