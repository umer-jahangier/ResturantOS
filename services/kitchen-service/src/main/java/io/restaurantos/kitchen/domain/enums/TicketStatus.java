package io.restaurantos.kitchen.domain.enums;

public enum TicketStatus {
    PENDING,
    COOKING,
    READY,
    // SERVED: the originating order was closed (fully paid AND served) — set by the
    // ORDER_CLOSED consumer. Terminal; excluded from the active board so a READY ticket stays
    // visible until the order is actually served/closed, then leaves.
    SERVED,
    CANCELLED
}
