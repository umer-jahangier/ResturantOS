package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * Order Management list row (POS-09). Plain, service-constructed record — no {@code from()}
 * factory (mirrors {@link MenuCategoryDto}'s shape, not {@link DiningTableDto}'s), since
 * building it requires joining table-name data the entity alone doesn't carry.
 */
public record OrderSummaryDto(
        UUID orderId,
        String orderNo,
        UUID tableId,
        String tableName,
        DerivedOrderStatus derivedStatus,
        UUID cashierId,
        int coverCount,
        long totalPaisa,
        Instant openedAt
) {}
