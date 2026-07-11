package io.restaurantos.kitchen.domain.enums;

/**
 * Kitchen-owned per-item lifecycle subset: PENDING -> ACCEPTED -> PREPARING -> READY.
 * COOKING is retained as a legacy value (pre-Phase-7.1 rows / existing bump flow) and is
 * treated as equivalent to PREPARING in downstream mapping — it is NOT removed so existing
 * persisted rows never fail deserialization. SENT/SERVED/CANCELLED are pos-service-owned
 * (OrderItemStatus) per the Architectural Responsibility Map and are not represented here.
 */
public enum TicketItemStatus {
    PENDING,
    ACCEPTED,
    PREPARING,
    COOKING,
    READY
}
