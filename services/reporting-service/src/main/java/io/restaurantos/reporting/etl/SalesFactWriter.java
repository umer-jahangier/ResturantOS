package io.restaurantos.reporting.etl;

import io.restaurantos.reporting.event.ReportingEventPayloads.DiscountEntry;
import io.restaurantos.reporting.event.ReportingEventPayloads.ItemEntry;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.OffsetDateTime;
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

    /** B3 — one row per discount on the check. See deploy/clickhouse/V004__discount_facts.sql. */
    private static final String INSERT_DISCOUNT_SQL = """
            INSERT INTO clickhouse_analytics.sales_discount_facts
                (tenant_id, branch_id, business_date, order_id, discount_no, order_no, scope,
                 order_item_id, item_name, discount_type, discount_value, amount_paisa, reason,
                 applied_by, applied_by_name, closed_at, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    private final JdbcTemplate clickHouseJdbcTemplate;

    public SalesFactWriter(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
    }

    public void write(EventEnvelope<OrderClosedPayload> env, LocalDate businessDate) {
        OrderClosedPayload payload = env.payload();
        // MUST go through AnalyticsInstant — a java.sql.Timestamp here silently stores local
        // wall-clock in a UTC column (DEFECT-37-03-B; see AnalyticsInstant for the measurements).
        OffsetDateTime closedAt = AnalyticsInstant.utc(payload.closedAt());

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

        writeDiscounts(env, businessDate, closedAt);

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

    /**
     * One row per discount on the closed check (B3).
     *
     * <p>The discount grain is the whole point: {@code sales_order_facts.discount_paisa} already
     * carried the sum, and a sum cannot be reviewed. These rows carry the reason and the person,
     * which is what turns "Rs 950 of discounts yesterday" into something an owner can act on.
     *
     * <p>Absent or empty {@code discounts} writes nothing and is not an error — that is every
     * check that was sold at full price, and every ORDER_CLOSED published before pos-service
     * carried the field.
     */
    private void writeDiscounts(EventEnvelope<OrderClosedPayload> env, LocalDate businessDate,
                                OffsetDateTime closedAt) {
        List<DiscountEntry> discounts = env.payload().discounts();
        if (discounts == null || discounts.isEmpty()) {
            return;
        }

        List<Object[]> batchArgs = new ArrayList<>(discounts.size());
        for (int discountNo = 0; discountNo < discounts.size(); discountNo++) {
            DiscountEntry d = discounts.get(discountNo);
            batchArgs.add(new Object[]{
                    env.tenantId(),
                    env.branchId(),
                    businessDate,
                    env.payload().orderId(),
                    discountNo,
                    env.payload().orderNo(),
                    d.scope(),
                    d.orderItemId(),
                    d.itemName(),
                    d.type(),
                    d.value(),
                    d.amountPaisa(),
                    // The column is non-nullable String: a discount with no reason at all is a
                    // row from before reasons were required, and it says so rather than being
                    // rendered as an empty cell a reader would take for "none given".
                    d.reason() == null || d.reason().isBlank() ? "Not recorded" : d.reason(),
                    d.appliedBy(),
                    d.appliedByName(),
                    closedAt,
                    env.eventId()
            });
        }
        clickHouseJdbcTemplate.batchUpdate(INSERT_DISCOUNT_SQL, batchArgs);
    }
}
