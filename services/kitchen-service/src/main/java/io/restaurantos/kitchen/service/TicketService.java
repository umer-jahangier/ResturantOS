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

    /** Mark the KDS line for a pos OrderItem CANCELLED (ORDER_ITEM_CANCELLED consumer). */
    void cancelTicketItem(UUID orderItemId);

    /** Mark an order's active tickets SERVED once the order is closed (ORDER_CLOSED consumer). */
    void serveTicketsForOrder(UUID orderId);

    /** Full ticket detail (all items, incl. revisionNo/firedAt) for the KDS "open ticket" view. */
    KdsTicketDto getTicketDetail(UUID ticketId);
}
