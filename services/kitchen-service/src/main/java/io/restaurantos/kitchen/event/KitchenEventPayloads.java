package io.restaurantos.kitchen.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class KitchenEventPayloads {

    private KitchenEventPayloads() {}

    // ─── Produce side ──────────────────────────────────────────────────────────

    public record OrderReadyPayload(UUID orderId, String station, Instant readyAt) {}

    // ─── Consume side (ORDER_SENT_TO_KDS from pos.topic) ──────────────────────

    public record OrderSentToKdsPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            List<OrderSentToKdsItem> items
    ) {}

    public record OrderSentToKdsItem(
            UUID orderItemId,
            UUID menuItemId,
            String name,
            int qty,
            String kdsStation,
            List<String> modifiers,
            String notes
    ) {}

    // ─── Consume side (ORDER_VOIDED from pos.topic) ───────────────────────────

    public record OrderVoidedPayload(UUID orderId, String reason, UUID voidedBy) {}
}
