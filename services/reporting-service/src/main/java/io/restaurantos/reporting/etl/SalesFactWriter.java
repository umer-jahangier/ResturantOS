package io.restaurantos.reporting.etl;

import io.restaurantos.reporting.event.ReportingEventPayloads.ItemEntry;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Writes ORDER_CLOSED into {@code sales_order_facts} (one row) and {@code sales_item_facts} (one
 * row per line item). tenant_id/branch_id/event_id are sourced from the ENVELOPE — never from the
 * payload, never from a request param — the money columns come from the payload.
 */
@Component
public class SalesFactWriter {

    private static final String INSERT_ORDER_SQL = """
            INSERT INTO clickhouse_analytics.sales_order_facts
                (tenant_id, branch_id, business_date, order_id, order_no, order_type, customer_id,
                 subtotal_paisa, discount_paisa, service_charge_paisa, tax_paisa, total_paisa,
                 till_session_id, cashier_id, closed_at, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    private static final String INSERT_ITEM_SQL = """
            INSERT INTO clickhouse_analytics.sales_item_facts
                (tenant_id, branch_id, business_date, order_id, line_no, menu_item_id, item_name,
                 qty, unit_price_paisa, line_total_paisa, cogs_paisa, gross_margin_paisa,
                 category_name, closed_at, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    private final JdbcTemplate clickHouseJdbcTemplate;

    public SalesFactWriter(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
    }

    public void write(EventEnvelope<OrderClosedPayload> env, LocalDate businessDate) {
        OrderClosedPayload payload = env.payload();
        Timestamp closedAt = Timestamp.from(payload.closedAt());

        clickHouseJdbcTemplate.update(INSERT_ORDER_SQL,
                env.tenantId(),
                env.branchId(),
                businessDate,
                payload.orderId(),
                payload.orderNo(),
                payload.type(),
                payload.customerId(),
                payload.subtotalPaisa(),
                payload.discountPaisa(),
                payload.serviceChargePaisa(),
                payload.taxPaisa(),
                payload.totalPaisa(),
                payload.tillSessionId(),
                payload.cashierId(),
                closedAt,
                env.eventId());

        List<ItemEntry> items = payload.items();
        if (items == null || items.isEmpty()) {
            return;
        }

        List<Object[]> batchArgs = new ArrayList<>(items.size());
        for (int lineNo = 0; lineNo < items.size(); lineNo++) {
            ItemEntry item = items.get(lineNo);
            batchArgs.add(new Object[]{
                    env.tenantId(),
                    env.branchId(),
                    businessDate,
                    payload.orderId(),
                    lineNo,
                    item.menuItemId(),
                    item.name(),
                    item.qty(),
                    item.unitPricePaisa(),
                    item.lineTotalPaisa(),
                    // cogs_paisa / gross_margin_paisa / category_name are Phase-8-deferred: Phase 8
                    // (Inventory & Recipe) has not started and OrderClosedPayload.ItemEntry carries
                    // no COGS/margin/category data today. NULL means "unknown" (12-05's reports
                    // render it as "—"); 0 would falsely claim "sold at cost", which is a lie an
                    // owner could act on. Never write 0 here.
                    null, // cogs_paisa
                    null, // gross_margin_paisa
                    null, // category_name
                    closedAt,
                    env.eventId()
            });
        }
        clickHouseJdbcTemplate.batchUpdate(INSERT_ITEM_SQL, batchArgs);
    }
}
