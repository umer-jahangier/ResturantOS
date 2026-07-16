package io.restaurantos.reporting.report;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Registry of named reports the ETL-landed ClickHouse facts (12-02/12-03) can honestly support
 * TODAY. Deliberately NOT the spec's "40 named reports" — a report backed by no data is a lie
 * (12-05-PLAN.md Task 1).
 *
 * <p><b>Deviation from plan prose:</b> the plan sketched a "purchases-by-vendor" report, but
 * {@code purchase_tax_facts} carries no {@code vendor_id} column — {@code VendorInvoiceMatchedPayload}
 * (the real, currently-publishing event) never included it, and 12-02-SUMMARY.md documents this
 * gap explicitly ("any report needing those must Feign-call purchasing-service or accept the
 * gap"). Shipping a per-vendor report against a fact table with no vendor identity would either
 * silently mis-group everything under one bucket or fabricate a join this service has no data
 * for. Renamed to {@code purchases-by-po}, grouped by the column that IS real:
 * {@code purchase_order_id}. Same class of finding as decisions 10-12-C/10-13-C.
 *
 * <p>Every report's SQL carries a leading tenant-id-bind predicate, written ONCE per
 * report in source ({@link #define}) — {@code sqlTenantWide} is mechanically derived from
 * {@code sqlBranchScoped} by stripping the branch predicate, so both variants are provably
 * consistent with each other and there is exactly one place per report where tenant isolation is
 * expressed.
 */
@Component
public class ReportCatalog {

    private final Map<String, ReportDefinition> definitions = new LinkedHashMap<>();

    public ReportCatalog() {
        register(salesByDay());
        register(salesByItem());
        register(salesByHour());
        register(salesByOrderType());
        register(discountSummary());
        register(tillSessions());
        register(purchasesByPo());
    }

    public List<ReportDefinition> list() {
        return List.copyOf(definitions.values());
    }

    public Optional<ReportDefinition> find(String code) {
        return Optional.ofNullable(definitions.get(code));
    }

    private void register(ReportDefinition definition) {
        definitions.put(definition.code(), definition);
    }

    // ── Sales (sales_order_facts / sales_item_facts) ────────────────────────────────

    private static ReportDefinition salesByDay() {
        String sql = """
                SELECT business_date, count() AS order_count,
                       sum(subtotal_paisa) AS subtotal_paisa, sum(discount_paisa) AS discount_paisa,
                       sum(tax_paisa) AS tax_paisa, sum(total_paisa) AS total_paisa
                FROM clickhouse_analytics.sales_order_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                GROUP BY business_date
                ORDER BY business_date
                LIMIT 10000
                """;
        return define("sales-by-day", "Sales by Day", "sales",
                List.of("business_date", "order_count", "subtotal_paisa", "discount_paisa", "tax_paisa", "total_paisa"),
                sql);
    }

    /**
     * {@code cogs_paisa} / {@code gross_margin_paisa} are Phase-8-deferred NULLs in
     * {@code sales_item_facts}. Plain {@code sum()} over an all-NULL Nullable column is NOT
     * trusted to return NULL here (ClickHouse's NULL-skipping sum semantics for an all-NULL
     * input are surprising across versions) — {@code countIf(... IS NOT NULL) = 0} is used to
     * force an honest NULL whenever no row in the group has a non-null value, rather than risk a
     * silent 0 that would tell an owner they sell at cost. Proven against a real container in
     * ReportServiceIT#salesByItem_cogsIsNull.
     */
    private static ReportDefinition salesByItem() {
        String sql = """
                SELECT menu_item_id, any(item_name) AS item_name, sum(qty) AS qty,
                       sum(line_total_paisa) AS gross_revenue_paisa,
                       if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa)) AS cogs_paisa,
                       if(countIf(gross_margin_paisa IS NOT NULL) = 0, NULL, sum(gross_margin_paisa)) AS gross_margin_paisa
                FROM clickhouse_analytics.sales_item_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                GROUP BY menu_item_id
                ORDER BY gross_revenue_paisa DESC
                LIMIT 10000
                """;
        return define("sales-by-item", "Sales by Item", "sales",
                List.of("menu_item_id", "item_name", "qty", "gross_revenue_paisa", "cogs_paisa", "gross_margin_paisa"),
                sql);
    }

    private static ReportDefinition salesByHour() {
        String sql = """
                SELECT toHour(closed_at) AS hour_of_day, count() AS order_count,
                       sum(total_paisa) AS revenue_paisa
                FROM clickhouse_analytics.sales_order_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                GROUP BY hour_of_day
                ORDER BY hour_of_day
                LIMIT 10000
                """;
        return define("sales-by-hour", "Sales by Hour (Peak Hours)", "sales",
                List.of("hour_of_day", "order_count", "revenue_paisa"),
                sql);
    }

    private static ReportDefinition salesByOrderType() {
        String sql = """
                SELECT order_type, count() AS order_count, sum(total_paisa) AS revenue_paisa
                FROM clickhouse_analytics.sales_order_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                GROUP BY order_type
                ORDER BY revenue_paisa DESC
                LIMIT 10000
                """;
        return define("sales-by-order-type", "Sales by Order Type", "sales",
                List.of("order_type", "order_count", "revenue_paisa"),
                sql);
    }

    private static ReportDefinition discountSummary() {
        String sql = """
                SELECT business_date, sum(discount_paisa) AS discount_paisa,
                       sum(subtotal_paisa) AS subtotal_paisa
                FROM clickhouse_analytics.sales_order_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                GROUP BY business_date
                ORDER BY business_date
                LIMIT 10000
                """;
        return define("discount-summary", "Discount Summary", "sales",
                List.of("business_date", "discount_paisa", "subtotal_paisa"),
                sql);
    }

    // ── Cash (till_session_facts) ────────────────────────────────────────────────────

    private static ReportDefinition tillSessions() {
        String sql = """
                SELECT till_session_id, cashier_id, business_date, expected_cash_paisa,
                       counted_cash_paisa, variance_paisa, closed_at
                FROM clickhouse_analytics.till_session_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                ORDER BY closed_at DESC
                LIMIT 10000
                """;
        return define("till-sessions", "Till Sessions", "cash",
                List.of("till_session_id", "cashier_id", "business_date", "expected_cash_paisa",
                        "counted_cash_paisa", "variance_paisa", "closed_at"),
                sql);
    }

    // ── Purchasing (purchase_tax_facts) ─────────────────────────────────────────────

    private static ReportDefinition purchasesByPo() {
        String sql = """
                SELECT purchase_order_id, business_date, count() AS invoice_count,
                       sum(total_paisa) AS spend_paisa, sum(input_tax_paisa) AS input_tax_paisa
                FROM clickhouse_analytics.purchase_tax_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                GROUP BY purchase_order_id, business_date
                ORDER BY business_date DESC
                LIMIT 10000
                """;
        return define("purchases-by-po", "Purchases by Purchase Order", "purchasing",
                List.of("purchase_order_id", "business_date", "invoice_count", "spend_paisa", "input_tax_paisa"),
                sql);
    }

    // ── Helper ───────────────────────────────────────────────────────────────────────

    private static ReportDefinition define(String code, String title, String category,
                                            List<String> columns, String sqlBranchScoped) {
        String sqlTenantWide = sqlBranchScoped.replace(" AND branch_id = ?", "");
        return new ReportDefinition(code, title, category, columns, sqlBranchScoped, sqlTenantWide);
    }
}
