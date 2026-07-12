package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.OrderType;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CreateOrderRequest(
        @NotNull UUID branchId,
        @NotNull UUID clientOrderId,
        OrderType type,
        UUID tableId,
        int coverCount,
        UUID customerId,
        String notes
) {}
