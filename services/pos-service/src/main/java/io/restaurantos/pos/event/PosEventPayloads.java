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
     * revisionNo/orderNotes/tableNumber are ADDITIVE fields appended after items — names must
     * match kitchen-service KitchenEventPayloads.OrderSentToKdsPayload EXACTLY (field-name
     * parity is the only contract enforcement; a mismatch silently drops every message —
     * RESEARCH.md Pitfall 4 / Phase-7 cold-start bug #4). Never reorder/rename existing fields.
     * {@code tableNumber} (KDS-04) is the order's dining-table number, or {@code null} for
     * takeaway/pickup orders with no bound table; the matching kitchen-side CONSUME field
     * lands in 07.3-05 — the name MUST stay {@code tableNumber} on both sides.
     * {@code orderType} is the OrderType enum name (DINE_IN/TAKEAWAY/DELIVERY/PICKUP) so the
     * kitchen expo can distinguish service types — additive trailing field, name MUST match the
     * kitchen-side consumer's {@code orderType} exactly.
     */
    public record OrderSentToKdsPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            String orderNo,
            List<KdsItemPayload> items,
            int revisionNo,
            String orderNotes,
            String tableNumber,
            String orderType
    ) {}

    /**
     * {@code stationId}/{@code stationName} (Phase 3) are ADDITIVE trailing fields carrying the
     * canonical, FK-backed station this line resolved to at fire time. {@code kdsStation} (the
     * code string) is RETAINED and stays load-bearing (it is still the kitchen's ticket/WS key);
     * when a station FK is present {@code kdsStation} carries that station's canonical code, else
     * the free-text snapshot (coalesced to "DEFAULT"). {@code stationId} is null for a line with
     * no station FK. Field names+order MUST stay byte-identical to kitchen-service
     * KitchenEventPayloads.OrderSentToKdsItem — never reorder/rename; only append.
     */
    public record KdsItemPayload(
            UUID orderItemId,
            UUID menuItemId,
            String name,
            int qty,
            String kdsStation,
            List<String> modifiers,
            String notes,
            UUID stationId,
            String stationName
    ) {}

    /**
     * ORDER_ITEM_CANCELLED — a single already-fired line was cancelled on the POS. The kitchen
     * consumes this to mark the matching KdsTicketItem (looked up by {@code orderItemId})
     * CANCELLED so the line is struck through on the board rather than lingering.
     */
    public record OrderItemCancelledPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            UUID orderItemId
    ) {}

    /**
     * ORDER_ITEM_SERVED — a single already-fired line was served (handed to the guest) on the POS
     * while the order is still open. The kitchen consumes this to mark the matching KdsTicketItem
     * (looked up by {@code orderItemId}) SERVED so the line leaves the Ready column immediately
     * rather than lingering until the whole order closes.
     */
    public record OrderItemServedPayload(
            UUID orderId,
            UUID tenantId,
            UUID branchId,
            UUID orderItemId
    ) {}

    private PosEventPayloads() {}
}
