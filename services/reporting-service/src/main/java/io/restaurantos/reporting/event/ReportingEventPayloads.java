package io.restaurantos.reporting.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Payload records mirroring the REAL, currently-publishing wire shapes — field names copied
 * verbatim from the producer source, never guessed. Deserialized via shared-lib's
 * {@code eventObjectMapper} (FAIL_ON_UNKNOWN_PROPERTIES disabled), so additive producer fields are
 * tolerated by construction.
 */
public final class ReportingEventPayloads {

    private ReportingEventPayloads() {}

    /**
     * ORDER_CLOSED — mirrors {@code io.restaurantos.pos.event.PosClosePayloads.OrderClosedPayload}
     * field-for-field (pos-service is not a Maven dependency of reporting-service).
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

    /**
     * TILL_CLOSED — mirrors the {@code Map.of(...)} payload published by
     * {@code TillServiceImpl.closeTill}. No {@code closedAt} field is published; the ETL uses the
     * wrapping {@code EventEnvelope.occurredAt()} for that column instead (see
     * TillSessionFactWriter / TillClosedConsumer and 12-03-SUMMARY.md).
     */
    public record TillClosedPayload(
            UUID tillSessionId,
            long expectedCashPaisa,
            long countedCashPaisa,
            long variancePaisa,
            UUID cashierId
    ) {}

    /**
     * VENDOR_INVOICE_MATCHED — mirrors the {@code Map<String, Object>} payload published by
     * {@code VendorInvoiceService.publishMatched}. No vendorId/invoiceNo/invoiceDate/subtotalPaisa
     * or matched-timestamp field is published (12-02-SUMMARY.md's finding); the ETL uses the
     * wrapping {@code EventEnvelope.occurredAt()} for {@code matched_at}.
     */
    public record VendorInvoiceMatchedPayload(
            UUID invoiceId,
            UUID poId,
            long amountPaisa,
            long inputTaxPaisa,
            String matchStatus
    ) {}
}
