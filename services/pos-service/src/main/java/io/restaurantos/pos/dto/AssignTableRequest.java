package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record AssignTableRequest(
        @NotNull UUID tableId
) {}
