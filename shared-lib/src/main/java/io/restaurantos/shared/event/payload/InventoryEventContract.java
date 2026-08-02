package io.restaurantos.shared.event.payload;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * THE wire contract for every {@code inventory.topic} event, owned here rather than duplicated
 * per service.
 *
 * <p><b>Why this class exists.</b> Producer and consumer used to declare their own copy of each
 * payload and agreement was enforced by a code comment ("field-name + order parity is the only
 * contract enforcement the shared strict ObjectMapper provides"). It did not hold. finance-service
 * read {@code lines[].variancePaisa} while inventory-service published
 * {@code lines[].varianceCostPaisa}, and {@code lines[].costPaisa} while inventory published
 * {@code unitCostPaisa} — so stock-count variances and inter-branch transfers were consumed,
 * acked, marked processed, and posted nothing. Silently: a missing key reads as {@code 0}, the
 * recipe's zero-guard returns early, and no exception is ever raised. Both defects survived a
 * green IT suite because the consumer tests hand-authored the payload with the consumer's own
 * guessed field names.
 *
 * <p>With one record shared by both sides, a rename is a compile error in every consumer instead
 * of a silent no-op in production. Consumers still deserialize through
 * {@code @Qualifier("eventObjectMapper")} (FAIL_ON_UNKNOWN_PROPERTIES disabled), so a producer
 * ADDING a field stays backward-compatible for consumers that have not been redeployed.
 */
public final class InventoryEventContract {

    private InventoryEventContract() {}

    public static final String EXCHANGE = "inventory.topic";

    public static final String STOCK_DEPLETED = "STOCK_DEPLETED";
    public static final String STOCK_RECEIVED = "STOCK_RECEIVED";
    public static final String LOW_STOCK_ALERT = "LOW_STOCK_ALERT";
    public static final String EXPIRY_ALERT = "EXPIRY_ALERT";
    public static final String COUNT_VARIANCE_POSTED = "COUNT_VARIANCE_POSTED";
    public static final String WASTAGE_RECORDED = "WASTAGE_RECORDED";
    public static final String TRANSFER_SHIPPED = "TRANSFER_SHIPPED";
    public static final String TRANSFER_RECEIVED = "TRANSFER_RECEIVED";
    public static final String TRANSFER_VARIANCE = "TRANSFER_VARIANCE";
    public static final String DEPLETION_INCOMPLETE = "DEPLETION_INCOMPLETE";

    public static final String STOCK_DEPLETED_KEY = "inventory.stock.depleted";
    public static final String STOCK_RECEIVED_KEY = "inventory.stock.received";
    public static final String LOW_STOCK_ALERT_KEY = "inventory.stock.low";
    public static final String EXPIRY_ALERT_KEY = "inventory.lot.expiry";
    public static final String COUNT_VARIANCE_POSTED_KEY = "inventory.count.variance";
    public static final String WASTAGE_RECORDED_KEY = "inventory.wastage.recorded";
    public static final String TRANSFER_SHIPPED_KEY = "inventory.transfer.shipped";
    public static final String TRANSFER_RECEIVED_KEY = "inventory.transfer.received";
    public static final String TRANSFER_VARIANCE_KEY = "inventory.transfer.variance";
    public static final String DEPLETION_INCOMPLETE_KEY = "inventory.depletion.incomplete";

    // ── STOCK_DEPLETED ──────────────────────────────────────────────────────
    /**
     * {@code cogsPaisa}/{@code totalCogsPaisa} are valued at the aggregate moving-average cost
     * ({@code avg_cost_paisa}), never a specific lot's purchase price — FEFO governs which lot
     * quantities drop, MAC governs what number posts as COGS. Never re-derive these from
     * {@code stock_lots.receipt_unit_cost_paisa}.
     *
     * <p>{@code lines} carries the per-ingredient breakdown finance needs to post COGS against the
     * ingredient's own category cost account rather than one global bucket.
     */
    public record StockDepletedPayload(UUID orderId, List<DepletedLine> lines, long totalCogsPaisa) {}

    /**
     * {@code cogsAccountCode}/{@code inventoryAccountCode} are the GL accounts this ingredient's
     * category names, resolved by inventory-service — the domain that knows the taxonomy — and
     * carried on the wire so finance never has to learn it.
     *
     * <p>Phase 08.2 built {@code ItemCategory.defaultCostAccountId}/{@code defaultInventoryAccountId}
     * with a validating finance proxy and a management UI, and nothing ever read them: every COGS
     * entry went to one global {@code COGS} tag. Both are nullable — a category that names no
     * account, or an ingredient whose category was archived, falls back to the tenant-wide tags,
     * so posting never fails for want of a mapping.
     */
    public record DepletedLine(UUID ingredientId, BigDecimal qtyBaseDepleted, long cogsPaisa,
                               String cogsAccountCode, String inventoryAccountCode) {

        /** Un-mapped line — falls back to the tenant-wide COGS/INVENTORY tags. */
        public DepletedLine(UUID ingredientId, BigDecimal qtyBaseDepleted, long cogsPaisa) {
            this(ingredientId, qtyBaseDepleted, cogsPaisa, null, null);
        }
    }

    // ── DEPLETION_INCOMPLETE ────────────────────────────────────────────────
    /** At least one sold line had no effective recipe at {@code closedAt}. Never a substitute for
     *  STOCK_DEPLETED — both may fire for a partially-covered order. */
    public record DepletionIncompletePayload(UUID orderId, Instant closedAt, List<UUID> missingMenuItemIds) {}

    // ── STOCK_RECEIVED ──────────────────────────────────────────────────────
    /**
     * Published by inventory-service and ONLY by inventory-service. purchasing-service used to
     * publish its own differently-shaped message under this same routing key on this same
     * exchange; it now publishes {@link PurchasingEventContract.GrnReceivedPayload} on its own
     * exchange and lets inventory own the stock write and this event.
     */
    public record StockReceivedPayload(
            UUID ingredientId,
            UUID branchId,
            BigDecimal qty,
            long unitCostPaisa,
            long totalCostPaisa,
            long newAvgCostPaisa,
            UUID lotId,
            LocalDate expiryDate,
            String referenceType,
            UUID referenceId
    ) {}

    // ── LOW_STOCK_ALERT / EXPIRY_ALERT ──────────────────────────────────────
    public record LowStockAlertPayload(UUID ingredientId, UUID branchId, BigDecimal qtyOnHand, BigDecimal reorderPoint) {}

    public record ExpiryAlertPayload(UUID lotId, UUID ingredientId, UUID branchId, LocalDate expiresOn, BigDecimal qty) {}

    // ── COUNT_VARIANCE_POSTED ───────────────────────────────────────────────
    public record CountVariancePostedPayload(
            UUID countId,
            UUID branchId,
            List<CountVarianceLine> lines,
            long totalVarianceCostPaisa
    ) {}

    /**
     * {@code varianceCostPaisa} is signed: negative is shrinkage (a loss), positive is a gain.
     * This is the field finance's count-variance recipe reads — it previously looked for
     * {@code variancePaisa}, which has never existed on the wire.
     *
     * <p>{@code overCap}/{@code overrideReason} are additive: a line that breached its category's
     * variance cap and was posted with an explicit reason carries both, everything else carries
     * {@code false}/null.
     */
    public record CountVarianceLine(UUID ingredientId, BigDecimal varianceQty, long varianceCostPaisa,
                                    boolean overCap, String overrideReason) {}

    // ── WASTAGE_RECORDED ────────────────────────────────────────────────────
    /**
     * {@code wastageId} is the ledger's source id — the key {@code posted_source_events} dedupes
     * on. It was absent from the original payload while finance's recipe required it, so the
     * consumer would have thrown on the first real message had a producer ever existed.
     */
    public record WastageRecordedPayload(
            UUID wastageId,
            UUID ingredientId,
            UUID branchId,
            BigDecimal qty,
            long costPaisa,
            String reason
    ) {}

    // ── TRANSFER_SHIPPED / TRANSFER_RECEIVED ────────────────────────────────
    public record TransferShippedPayload(UUID transferId, UUID fromBranchId, UUID toBranchId, List<TransferLine> lines) {}

    public record TransferReceivedPayload(UUID transferId, UUID toBranchId, List<TransferLine> lines) {}

    /**
     * {@code lineCostPaisa} is the extended cost of the line, computed by the producer.
     *
     * <p>It exists because the consumer must never re-derive money from a {@code BigDecimal}
     * quantity: rounding policy belongs where the domain lives. finance's transfer recipes used to
     * sum a {@code costPaisa} field that was never published — the payload carried only
     * {@code qty} and {@code unitCostPaisa} and no total at all — so every transfer summed to zero
     * and posted nothing.
     */
    public record TransferLine(UUID ingredientId, BigDecimal qty, long unitCostPaisa, long lineCostPaisa) {}

    public record TransferVariancePayload(UUID transferId, List<TransferVarianceLine> lines) {}

    public record TransferVarianceLine(UUID ingredientId, BigDecimal varianceQty, long varianceCostPaisa) {}
}
