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
     * ORDER_SENT_TO_KDS — emitted when order transitions OPEN -> SENT_TO_KDS.
     * The items list is consumed by the KDS to display per-station work items.
     */
    public record OrderSentToKdsPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            List<KdsItemPayload> items
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
