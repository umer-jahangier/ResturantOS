package io.restaurantos.kitchen.domain.enums;

public enum TicketStatus {
    PENDING,
    COOKING,
    READY,
    // SERVED: the originating order was closed (fully paid AND served) — set by the
    // ORDER_CLOSED consumer. Terminal; excluded from the active board so a READY ticket stays
    // visible until the order is actually served/closed, then leaves.
    SERVED,
    CANCELLED,
    // CLEARED: a person took this ticket off the board because the business day it was
    // received on had already closed (F17). Terminal for the ACTIVE board in exactly the
    // same way SERVED and CANCELLED are — the board queries PENDING,COOKING,READY — but it
    // is a different fact and must not be spelled as either of them. A cleared ticket was
    // not served (nobody handed the food over) and was not cancelled (the order was not
    // voided; it may still be open on the POS). Reusing SERVED here would have written a
    // false statement into the kitchen's own record of the day.
    //
    // The row survives: cleared_at/cleared_by are stamped, every item and the original
    // receivedAt stay, and GET /kds/tickets?status=CLEARED reads them back. A later
    // revision fired for the same order re-opens the ticket to PENDING (TicketRoutingService),
    // so clearing a board can never swallow work that arrives afterwards.
    CLEARED
}
