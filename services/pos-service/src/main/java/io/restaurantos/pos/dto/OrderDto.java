package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.KdsItemStatus;
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
    public record OrderItemDto(
            UUID id,
            UUID menuItemId,
            String itemNameSnapshot,
            long unitPriceSnapshot,
            int quantity,
            String kdsStation,
            KdsItemStatus kdsStatus,
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
