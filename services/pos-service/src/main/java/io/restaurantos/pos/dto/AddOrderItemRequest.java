package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

public record AddOrderItemRequest(
        @NotNull UUID menuItemId,
        @NotNull UUID branchId,
        @Min(1) int quantity,
        List<UUID> modifierIds,
        String notes
) {}
