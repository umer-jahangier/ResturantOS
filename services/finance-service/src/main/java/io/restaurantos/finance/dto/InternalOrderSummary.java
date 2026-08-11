package io.restaurantos.finance.dto;

import java.time.Instant;
import java.util.UUID;

/** Mirrors pos-service's {@code InternalOrderSummaryDto} field-for-field (37-04). */
public record InternalOrderSummary(
        UUID orderId,
        String orderNo,
        UUID branchId,
        UUID cashierId,
        Instant closedAt
) {}
