package io.restaurantos.shared.event.payload;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * THE wire contract for the {@code purchasing.topic} events consumed outside purchasing-service.
 *
 * @see InventoryEventContract for why these records are shared rather than duplicated
 */
public final class PurchasingEventContract {

    private PurchasingEventContract() {}

    public static final String EXCHANGE = "purchasing.topic";

    public static final String GRN_RECEIVED = "GRN_RECEIVED";
    public static final String VENDOR_INVOICE_MATCHED = "VENDOR_INVOICE_MATCHED";
    public static final String PO_APPROVED = "PO_APPROVED";
    public static final String PO_CLOSED = "PO_CLOSED";
    public static final String AP_PAYMENT_PROCESSED = "AP_PAYMENT_PROCESSED";

    public static final String GRN_RECEIVED_KEY = "purchasing.grn.received";
    public static final String VENDOR_INVOICE_MATCHED_KEY = "purchasing.invoice.matched";
    public static final String PO_APPROVED_KEY = "purchasing.po.approved";
    public static final String PO_CLOSED_KEY = "purchasing.po.closed";
    public static final String AP_PAYMENT_PROCESSED_KEY = "purchasing.payment.processed";

    /**
     * GRN_RECEIVED — goods physically arrived against a purchase order.
     *
     * <p>This event replaces the {@code STOCK_RECEIVED} message purchasing-service used to publish
     * onto {@code inventory.topic}. That was wrong twice over: it impersonated inventory-service
     * on inventory's own exchange and routing key with an incompatible shape
     * ({@code qtyReceived} vs {@code qty}, no cost at all), and nothing consumed it — inventory
     * has only ever had a menu-item consumer and an order-closed consumer. A goods receipt posted
     * its GR/IR entry to finance and then evaporated: {@code qty_on_hand}, {@code stock_lots} and
     * the moving-average cost never moved, so stock could only ever be entered by hand.
     *
     * <p>inventory-service consumes this, calls its own {@code ReceiptService} — the same tested
     * path the manual receipt screen uses — and publishes the real
     * {@link InventoryEventContract.StockReceivedPayload} itself. Inventory keeps sole ownership
     * of the stock write, of MAC, and of STOCK_RECEIVED.
     *
     * <p>Idempotent on {@code grnId}: purchasing may retry freely.
     */
    public record GrnReceivedPayload(
            UUID grnId,
            UUID poId,
            UUID branchId,
            UUID vendorId,
            LocalDate receivedOn,
            List<GrnLine> lines
    ) {}

    /**
     * {@code unitCostPaisa} is the PO line's contracted price. It is what makes the receipt feed
     * moving-average cost with a real vendor price instead of a hand-typed one — the whole reason
     * COGS and AP were previously valued off unrelated numbers.
     *
     * <p><b>{@code qtyReceived} and {@code unitCostPaisa} are in the vendor's ORDER unit</b> — a case,
     * a sack, a 10&nbsp;kg carton — which is very often not the unit the ingredient is stocked in.
     * Converting to stock units takes two steps, and only the first belongs to purchasing:
     *
     * <ol>
     *   <li>{@code qtyPerOrderUnit} — how many {@code qtyUomCode} units are in one order unit
     *       (a carton holds 10&nbsp;kg). Vendor-catalog data; purchasing owns it.</li>
     *   <li>{@code qtyUomCode} → the ingredient's base UOM (kg → g). A unit conversion;
     *       <b>inventory</b> owns the UOM registry and resolves this itself.</li>
     * </ol>
     *
     * <p>Only step 1 was ever applied, and {@code VendorItemService} says so in a comment: "this
     * catalog does not yet carry a separate pack-UOM-to-stock-UOM factor". Step 2 was the missing
     * seam, and omitting it silently corrupts both quantity and valuation. Receiving ten 1&nbsp;kg
     * cartons of an ingredient stocked in grams added <b>10</b> grams instead of 10,000, and booked
     * the carton price as the price of a single gram: on the live stack a PKR&nbsp;6,200 receipt moved
     * moving-average cost from 50 to 222 paisa per gram. Nothing failed — the receipt succeeded and
     * the journal entry balanced — but MAC, COGS, food-cost % and gross margin were all wrong by the
     * ratio between the two units.
     *
     * <p>A null or non-positive {@code qtyPerOrderUnit} means one; a blank {@code qtyUomCode} means
     * "already the ingredient's base unit". The consumer never guesses a conversion from the order
     * UOM, because a vendor order unit ("case", "pallet") is frequently not a UOM at all.
     */
    public record GrnLine(
            UUID poLineId,
            UUID ingredientId,
            BigDecimal qtyReceived,
            long unitCostPaisa,
            LocalDate expiryDate,
            BigDecimal qtyPerOrderUnit,
            String qtyUomCode
    ) {
        /** Older payloads and hand-built test lines: one order unit, already in the stock unit. */
        public GrnLine(UUID poLineId, UUID ingredientId, BigDecimal qtyReceived,
                       long unitCostPaisa, LocalDate expiryDate) {
            this(poLineId, ingredientId, qtyReceived, unitCostPaisa, expiryDate, null, null);
        }

        /** Quantity in {@link #qtyUomCode} units — step 1 applied, step 2 left to inventory. */
        public BigDecimal qtyInPackUom() {
            return qtyReceived.multiply(packFactor());
        }

        /**
         * Cost per {@link #qtyUomCode} unit. Derived from the same factor as the quantity so the two
         * can never disagree; scale 6 leaves room for a per-gram price under a carton-level cost.
         */
        public BigDecimal unitCostPerPackUomPaisa() {
            return BigDecimal.valueOf(unitCostPaisa)
                    .divide(packFactor(), 6, java.math.RoundingMode.HALF_UP);
        }

        private BigDecimal packFactor() {
            return qtyPerOrderUnit == null || qtyPerOrderUnit.signum() <= 0
                    ? BigDecimal.ONE : qtyPerOrderUnit;
        }
    }

    /** VENDOR_INVOICE_MATCHED — consumed by reporting's purchase-fact ETL and finance's AP posting. */
    public record VendorInvoiceMatchedPayload(
            UUID invoiceId,
            UUID poId,
            UUID vendorId,
            UUID branchId,
            long amountPaisa,
            long inputTaxPaisa,
            String matchStatus
    ) {}
}
