package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.dto.KdsTicketDto;

import java.util.UUID;

public interface TicketService {

    KdsTicketDto markItemStatus(UUID ticketId, UUID itemId, TicketItemStatus newStatus);

    /** Advances an item PENDING->COOKING or COOKING->READY based on its current status. */
    KdsTicketDto bumpItem(UUID ticketId, UUID itemId);

    KdsTicketDto recallTicket(UUID ticketId);

    void cancelTicketsForOrder(UUID orderId);
}
