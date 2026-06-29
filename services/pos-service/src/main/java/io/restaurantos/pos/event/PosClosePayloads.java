package io.restaurantos.pos.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Strongly-typed payload records for ORDER_CLOSED event.
 * Field names match the research event table contract EXACTLY.
 * Consumed by: Inventory (Phase 8), Finance (Phase 9), CRM (Phase 9), Reporting (Phase 12).
 */
public class PosClosePayloads {

    /**
     * ORDER_CLOSED payload — emitted once per close, idempotent via Idempotency-Key.
     * customerId is nullable (walk-in orders have no customer).
     */
    public record OrderClosedPayload(
            UUID orderId,
            String orderNo,
            String type,
            UUID customerId,
            long subtotalPaisa,
            long discountPaisa,
            long serviceChargePaisa,
            long taxPaisa,
            long totalPaisa,
            List<PaymentEntry> payments,
            List<ItemEntry> items,
            UUID tillSessionId,
            UUID cashierId,
            Instant closedAt
    ) {}

    public record PaymentEntry(
            String method,
            long amountPaisa,
            String referenceNo
    ) {}

    public record ItemEntry(
            UUID menuItemId,
            String name,
            int qty,
            long unitPricePaisa,
            long lineTotalPaisa
    ) {}

    private PosClosePayloads() {}
}
