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
     */
    public record GrnLine(
            UUID poLineId,
            UUID ingredientId,
            BigDecimal qtyReceived,
            long unitCostPaisa,
            LocalDate expiryDate
    ) {}

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
