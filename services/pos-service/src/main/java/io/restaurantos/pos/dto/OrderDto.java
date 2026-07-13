package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderDto(
        UUID id,
        UUID branchId,
        String orderNo,
        OrderType type,
        OrderStatus status,
        DerivedOrderStatus derivedStatus,
        UUID tableId,
        int coverCount,
        UUID cashierId,
        UUID customerId,
        long subtotalPaisa,
        long taxPaisa,
        long discountPaisa,
        long serviceChargePaisa,
        long totalPaisa,
        String notes,
        Instant openedAt,
        Instant sentToKdsAt,
        UUID clientOrderId,
        long version,
        List<OrderItemDto> items
) {
    // Wire field kept named kdsStatus (type OrderItemStatus, the 7-value lifecycle) rather
    // than renamed to itemStatus — plan 07.1-01's decision, avoiding a second JSON-contract
    // break this cycle; the frontend enum-value/name update is deferred (PATTERNS.md).
    public record OrderItemDto(
            UUID id,
            UUID menuItemId,
            String itemNameSnapshot,
            long unitPriceSnapshot,
            int quantity,
            String kdsStation,
            OrderItemStatus kdsStatus,
            int revisionNo,
            Instant firedAt,
            long discountPaisa,
            long taxPaisa,
            long lineTotalPaisa,
            String notes,
            List<ModifierDto> modifiers
    ) {}

    public record ModifierDto(
            UUID id,
            UUID modifierId,
            String modifierNameSnapshot,
            long priceDeltaPaisa
    ) {}
}
