package io.restaurantos.nlq.validation.stage;

import java.util.Locale;

/**
 * Shared table/column name normalisation so every stage agrees on what "the same table" means.
 *
 * <p>ClickHouse queries may reference a table either bare ({@code sales_order_facts}) or fully
 * qualified with the analytics database ({@code clickhouse_analytics.sales_order_facts}) — both
 * must resolve to the same allowlist/PII-map entry, or the qualifier becomes a bypass.
 */
final class SqlNames {

    private static final String DATABASE_PREFIX = "clickhouse_analytics.";

    private SqlNames() {
    }

    static String normalizeTable(String rawName) {
        if (rawName == null) {
            return null;
        }
        String lower = rawName.toLowerCase(Locale.ROOT);
        if (lower.startsWith(DATABASE_PREFIX)) {
            lower = lower.substring(DATABASE_PREFIX.length());
        }
        return lower;
    }

    static String normalizeColumn(String rawName) {
        return rawName == null ? null : rawName.toLowerCase(Locale.ROOT);
    }
}
