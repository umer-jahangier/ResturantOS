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
        String orderNotes,
        String tableNumber,
        String orderType,
        String stationCode,
        TicketStatus status,
        boolean priority,
        Instant receivedAt,
        Instant startedAt,
        Instant readyAt,
        /** Set only on a ticket a person cleared off the board (F17); null on every other. */
        Instant clearedAt,
        List<ItemDto> items
) {
    public record ItemDto(
            UUID id,
            UUID orderItemId,
            String name,
            int qty,
            List<String> modifiers,
            String notes,
            TicketItemStatus status,
            int revisionNo,
            Instant firedAt
    ) {}
}
