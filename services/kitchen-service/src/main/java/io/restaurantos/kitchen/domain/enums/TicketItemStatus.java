package io.restaurantos.kitchen.domain.enums;

/**
 * Kitchen-owned per-item lifecycle subset: PENDING -> ACCEPTED -> PREPARING -> READY.
 * COOKING is retained as a legacy value (pre-Phase-7.1 rows / existing bump flow) and is
 * treated as equivalent to PREPARING in downstream mapping — it is NOT removed so existing
 * persisted rows never fail deserialization. SENT is pos-service-owned (OrderItemStatus) and
 * is not represented here; CANCELLED and SERVED ARE mirrored on the KDS side (see below) so a
 * line the POS cancels/serves after firing stops showing as active work on the board.
 */
public enum TicketItemStatus {
    PENDING,
    ACCEPTED,
    PREPARING,
    COOKING,
    READY,
    // CANCELLED (KDS side): the POS cancelled this line after it was fired. Set by the
    // ORDER_ITEM_CANCELLED consumer so the board can strike it through / stop the cook working
    // on it. Terminal — excluded from the "not ready" count so it never blocks a ticket.
    CANCELLED,
    // SERVED (KDS side): the POS served this line (handed to the guest) after it was fired,
    // while the order is still open. Set by the ORDER_ITEM_SERVED consumer so the line leaves
    // the Ready column instead of lingering (it maps to no board column, like CANCELLED).
    // Terminal — excluded from the "not ready" count so it never blocks a ticket.
    SERVED
}
