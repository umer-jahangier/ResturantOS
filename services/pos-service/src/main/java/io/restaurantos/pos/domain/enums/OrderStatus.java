package io.restaurantos.pos.domain.enums;

public enum OrderStatus {
    DRAFT,
    OPEN,
    SENT_TO_KDS,
    PARTIAL_READY,
    READY,
    SERVED,
    CLOSED,
    VOIDED,
    REFUNDED
}
