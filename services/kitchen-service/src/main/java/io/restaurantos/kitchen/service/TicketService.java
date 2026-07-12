package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.dto.KdsTicketDto;

import java.util.UUID;

public interface TicketService {

    KdsTicketDto markItemStatus(UUID ticketId, UUID itemId, TicketItemStatus newStatus);

    KdsTicketDto recallTicket(UUID ticketId);

    void cancelTicketsForOrder(UUID orderId);
}
