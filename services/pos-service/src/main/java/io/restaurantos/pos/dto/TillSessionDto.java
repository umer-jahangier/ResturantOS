package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.TillStatus;

import java.time.Instant;
import java.util.UUID;

public record TillSessionDto(
        UUID id,
        UUID branchId,
        UUID cashierId,
        long openingFloatPaisa,
        Long expectedClosingPaisa,
        Long declaredClosingPaisa,
        Long variancePaisa,
        TillStatus status,
        Instant openedAt,
        Instant closedAt
) {}
