package io.restaurantos.kitchen.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class KitchenEventPayloads {

    private KitchenEventPayloads() {}

    // ─── Produce side ──────────────────────────────────────────────────────────

    public record OrderReadyPayload(UUID orderId, String station, Instant readyAt) {}

    // ─── Consume side (ORDER_SENT_TO_KDS from pos.topic) ──────────────────────

    // revisionNo/orderNotes are ADDITIVE fields appended after items — names must match
    // pos-service PosEventPayloads.OrderSentToKdsPayload EXACTLY (field-name parity is the
    // only contract enforcement; a mismatch silently drops every message — RESEARCH.md
    // Pitfall 4 / Phase-7 cold-start bug #4). Never reorder/rename the existing fields.
    public record OrderSentToKdsPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            List<OrderSentToKdsItem> items,
            int revisionNo,
            String orderNotes
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
