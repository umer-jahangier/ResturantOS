package io.restaurantos.pos.event;

import java.util.List;
import java.util.UUID;

/**
 * Strongly-typed event payload records for POS domain events.
 * Field names match the research event table contract EXACTLY.
 * These payloads are consumed by Kitchen (07-04), Inventory (Phase 8),
 * Finance (Phase 9), CRM (Phase 9), and Reporting (Phase 12).
 */
public class PosEventPayloads {

    /**
     * ORDER_CREATED — emitted when first item added to a DRAFT order (DRAFT -> OPEN).
     */
    public record OrderCreatedPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            String type,
            UUID tableId,
            int coverCount,
            UUID cashierId,
            UUID customerId,
            UUID clientOrderId
    ) {}

    /**
     * ORDER_SENT_TO_KDS — emitted on every sendToKds fire (first fire OPEN -> SENT_TO_KDS,
     * or a repeated revision fire on an already-sent order). {@code items} contains ONLY the
     * newly-fired (previously PENDING) lines for THIS fire — never the full order (POS-12).
     * revisionNo/orderNotes are ADDITIVE fields appended after items — names must match
     * kitchen-service KitchenEventPayloads.OrderSentToKdsPayload EXACTLY (field-name parity
     * is the only contract enforcement; a mismatch silently drops every message —
     * RESEARCH.md Pitfall 4 / Phase-7 cold-start bug #4). Never reorder/rename existing fields.
     */
    public record OrderSentToKdsPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            List<KdsItemPayload> items,
            int revisionNo,
            String orderNotes
    ) {}

    public record KdsItemPayload(
            UUID orderItemId,
            UUID menuItemId,
            String name,
            int qty,
            String kdsStation,
            List<String> modifiers,
            String notes
    ) {}

    private PosEventPayloads() {}
}
