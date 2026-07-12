package io.restaurantos.kitchen.dto;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.enums.TicketStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record KdsTicketDto(
        UUID id,
        UUID orderId,
        String orderNo,
        String stationCode,
        TicketStatus status,
        boolean priority,
        Instant receivedAt,
        Instant startedAt,
        Instant readyAt,
        List<ItemDto> items
) {
    public record ItemDto(
            UUID id,
            UUID orderItemId,
            String name,
            int qty,
            List<String> modifiers,
            String notes,
            TicketItemStatus status
    ) {}
}
