package io.restaurantos.inventory.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Strongly-typed payload records for every event inventory-service consumes or publishes.
 *
 * Inbound: {@link OrderClosedPayload} / {@link ItemEntry} / {@link PaymentEntry} mirror
 * pos-service's {@code PosClosePayloads} wire shape EXACTLY (field-name + order parity is the
 * only contract enforcement the shared strict ObjectMapper provides) — depletion resolves
 * recipes locally from {@code items[].menuItemId} and uses {@code closedAt} for D-01's
 * effective-recipe-version lookup. There is no {@code openedAt} on this event.
 *
 * Outbound: every inventory.topic event this service publishes, with its event-type constant
 * and routing key.
 */
public final class InventoryEventPayloads {

    private InventoryEventPayloads() {}

    // ─── Consume side (ORDER_CLOSED from pos.topic) ───────────────────────────

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

    // ─── Consume side (MENU_ITEM_UPSERTED/MENU_ITEM_DELETED from pos.topic) ────
    // D-02: field-name + order parity with pos-service's PosEventPayloads
    // MenuItemUpsertedPayload/MenuItemDeletedPayload (08.1-01) — the cross-service contract.

    public static final String MENU_ITEM_UPSERTED = "MENU_ITEM_UPSERTED";
    public static final String MENU_ITEM_DELETED = "MENU_ITEM_DELETED";

    public record MenuItemUpsertedPayload(
            UUID menuItemId,
            String name,
            UUID categoryId,
            String categoryName,
            boolean active,
            long basePricePaisa,
            Instant updatedAt
    ) {}

    public record MenuItemDeletedPayload(UUID menuItemId) {}

    // ─── Produce side (inventory.topic) ────────────────────────────────────────

    public static final String STOCK_DEPLETED = "STOCK_DEPLETED";
    public static final String STOCK_RECEIVED = "STOCK_RECEIVED";
    public static final String LOW_STOCK_ALERT = "LOW_STOCK_ALERT";
    public static final String EXPIRY_ALERT = "EXPIRY_ALERT";
    public static final String COUNT_VARIANCE_POSTED = "COUNT_VARIANCE_POSTED";
    public static final String WASTAGE_RECORDED = "WASTAGE_RECORDED";
    public static final String TRANSFER_SHIPPED = "TRANSFER_SHIPPED";
    public static final String TRANSFER_RECEIVED = "TRANSFER_RECEIVED";
    public static final String TRANSFER_VARIANCE = "TRANSFER_VARIANCE";

    public static final String STOCK_DEPLETED_ROUTING_KEY = "inventory.stock.depleted";
    public static final String STOCK_RECEIVED_ROUTING_KEY = "inventory.stock.received";
    public static final String LOW_STOCK_ALERT_ROUTING_KEY = "inventory.stock.low";
    public static final String EXPIRY_ALERT_ROUTING_KEY = "inventory.lot.expiry";
    public static final String COUNT_VARIANCE_POSTED_ROUTING_KEY = "inventory.count.variance";
    public static final String WASTAGE_RECORDED_ROUTING_KEY = "inventory.wastage.recorded";
    public static final String TRANSFER_SHIPPED_ROUTING_KEY = "inventory.transfer.shipped";
    public static final String TRANSFER_RECEIVED_ROUTING_KEY = "inventory.transfer.received";
    public static final String TRANSFER_VARIANCE_ROUTING_KEY = "inventory.transfer.variance";

    /**
     * Published after a successful depletion. cogsPaisa/totalCogsPaisa are valued at the
     * aggregate moving-average cost (avg_cost_paisa), never a specific lot's purchase price —
     * FEFO (D-04) governs which lot quantities drop, MAC (INV-03) governs what number posts as
     * COGS. Never re-derive these from stock_lots.receipt_unit_cost_paisa.
     */
    public record StockDepletedPayload(UUID orderId, List<DepletedLine> lines, long totalCogsPaisa) {}

    public record DepletedLine(UUID ingredientId, BigDecimal qtyBaseDepleted, long cogsPaisa) {}

    public static final String DEPLETION_INCOMPLETE = "DEPLETION_INCOMPLETE";
    public static final String DEPLETION_INCOMPLETE_ROUTING_KEY = "inventory.depletion.incomplete";

    /**
     * D-03: published whenever at least one ORDER_CLOSED line had no effective recipe at
     * {@code closedAt} — independent of {@link StockDepletedPayload}, never a substitute for it.
     * Both may publish for the same order (partial coverage); this alone publishes when EVERY
     * line was uncovered (no STOCK_DEPLETED in that case).
     */
    public record DepletionIncompletePayload(UUID orderId, Instant closedAt, List<UUID> missingMenuItemIds) {}

    public record StockReceivedPayload(
            UUID ingredientId,
            UUID branchId,
            BigDecimal qty,
            long unitCostPaisa,
            long newAvgCostPaisa,
            UUID lotId,
            LocalDate expiryDate
    ) {}

    public record LowStockAlertPayload(UUID ingredientId, UUID branchId, BigDecimal qtyOnHand, BigDecimal reorderPoint) {}

    /** Published by the nightly @Scheduled FEFO expiry sweep (D-04) — never per-batch timers. */
    public record ExpiryAlertPayload(UUID lotId, UUID ingredientId, UUID branchId, LocalDate expiresOn, BigDecimal qty) {}

    public record CountVariancePostedPayload(
            UUID countId,
            UUID branchId,
            List<CountVarianceLine> lines,
            long totalVarianceCostPaisa
    ) {}

    public record CountVarianceLine(UUID ingredientId, BigDecimal varianceQty, long varianceCostPaisa) {}

    public record WastageRecordedPayload(UUID ingredientId, UUID branchId, BigDecimal qty, long costPaisa, String reason) {}

    public record TransferShippedPayload(UUID transferId, UUID fromBranchId, UUID toBranchId, List<TransferLine> lines) {}

    public record TransferReceivedPayload(UUID transferId, UUID toBranchId, List<TransferLine> lines) {}

    public record TransferLine(UUID ingredientId, BigDecimal qty, long unitCostPaisa) {}

    public record TransferVariancePayload(UUID transferId, List<TransferVarianceLine> lines) {}

    public record TransferVarianceLine(UUID ingredientId, BigDecimal varianceQty, long varianceCostPaisa) {}
}
