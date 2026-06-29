package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.util.UUID;

public record ApplyDiscountRequest(
        @NotNull String scope,
        UUID orderItemId,
        @NotNull String type,
        @NotNull @Positive BigDecimal value
) {}
