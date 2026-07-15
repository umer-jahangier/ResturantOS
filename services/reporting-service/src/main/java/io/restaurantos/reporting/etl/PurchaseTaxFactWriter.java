package io.restaurantos.reporting.etl;

import io.restaurantos.reporting.event.ReportingEventPayloads.VendorInvoiceMatchedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.LocalDate;

/**
 * Writes VENDOR_INVOICE_MATCHED into {@code purchase_tax_facts} — the FBR INPUT TAX source for
 * the Tax Summary report (12-05). {@code matched_at} is sourced from the envelope's
 * {@code occurredAt} because the real published payload carries no match timestamp field (see
 * ReportingEventPayloads.VendorInvoiceMatchedPayload).
 */
@Component
public class PurchaseTaxFactWriter {

    private static final String INSERT_SQL = """
            INSERT INTO clickhouse_analytics.purchase_tax_facts
                (tenant_id, branch_id, business_date, invoice_id, purchase_order_id,
                 input_tax_paisa, total_paisa, match_status, matched_at, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    private final JdbcTemplate clickHouseJdbcTemplate;

    public PurchaseTaxFactWriter(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
    }

    public void write(EventEnvelope<VendorInvoiceMatchedPayload> env, LocalDate businessDate) {
        VendorInvoiceMatchedPayload payload = env.payload();
        clickHouseJdbcTemplate.update(INSERT_SQL,
                env.tenantId(),
                env.branchId(),
                businessDate,
                payload.invoiceId(),
                payload.poId(),
                payload.inputTaxPaisa(),
                payload.amountPaisa(),
                payload.matchStatus(),
                Timestamp.from(env.occurredAt()),
                env.eventId());
    }
}
