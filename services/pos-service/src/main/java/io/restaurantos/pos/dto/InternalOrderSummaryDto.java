package io.restaurantos.pos.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * The MINIMUM finance needs to name an order in words an owner recognises (37-04).
 *
 * <p>Deliberately four fields and no lines. finance has no business holding what was eaten; it
 * needs to render "Order ORD-20260807-0001, main branch, closed 05:46" beside a journal entry and
 * nothing more. Widening this record later is a decision to be argued for, not a convenience.
 */
public record InternalOrderSummaryDto(
        UUID orderId,
        String orderNo,
        UUID branchId,
        UUID cashierId,
        Instant closedAt
) {}
