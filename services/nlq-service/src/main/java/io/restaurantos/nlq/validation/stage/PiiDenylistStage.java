package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.ExpressionVisitorAdapter;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.statement.select.AllColumns;
import net.sf.jsqlparser.statement.select.AllTableColumns;
import net.sf.jsqlparser.statement.select.PlainSelect;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.statement.select.SelectItem;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Stage 4 — a configured deny-list of {@code table.column} pairs
 * ({@code restaurantos.nlq.pii-denylist}). A {@code SELECT *} (or {@code t.*}) that would expand
 * to include a denied column is rejected too — star-expansion is the obvious bypass otherwise.
 *
 * <p>Full analysis is performed for the single-table {@link PlainSelect} shape — the only shape
 * the tenant-filter stage can ultimately prove safe (see {@link TenantFilterStage}). Any other
 * shape (UNION, CTE, subquery-in-FROM) is rejected downstream regardless, so this stage is a
 * deliberate no-op for those — the pipeline still fails safe.
 */
public class PiiDenylistStage {

    /** normalized table name -> normalized denied column names */
    private final Map<String, Set<String>> deniedByTable;

    public PiiDenylistStage(List<String> tableDotColumnPairs) {
        this.deniedByTable = new HashMap<>();
        for (String pair : tableDotColumnPairs) {
            int dot = pair.indexOf('.');
            if (dot < 0) {
                continue;
            }
            String table = SqlNames.normalizeTable(pair.substring(0, dot));
            String column = SqlNames.normalizeColumn(pair.substring(dot + 1));
            deniedByTable.computeIfAbsent(table, t -> new HashSet<>()).add(column);
        }
    }

    public void validate(Select select) {
        if (!(select instanceof PlainSelect plainSelect)) {
            return;
        }

        Table fromTable = plainSelect.getFromItem() instanceof Table t ? t : null;
        String singleTable = fromTable == null
                ? null
                : SqlNames.normalizeTable(fromTable.getFullyQualifiedName());
        String fromAlias = fromTable != null && fromTable.getAlias() != null
                ? SqlNames.normalizeTable(fromTable.getAlias().getName())
                : null;
        Set<String> denied = singleTable == null
                ? Set.of()
                : deniedByTable.getOrDefault(singleTable, Set.of());

        for (SelectItem<?> item : plainSelect.getSelectItems()) {
            Expression expr = item.getExpression();

            if (expr instanceof AllTableColumns allTableColumns) {
                // The qualifier of a `t.*` is the table's ALIAS when the FROM item is aliased —
                // NOT the real table name. Resolve it against the FROM table's alias/name so an
                // alias can never be used to smuggle a star past the deny-list. Fail closed: an
                // unresolved qualifier over a single table with denied columns is still rejected.
                String qualifier = SqlNames.normalizeTable(
                        allTableColumns.getTable().getFullyQualifiedName());
                Set<String> starDenied;
                if (qualifier.equals(fromAlias) || qualifier.equals(singleTable)) {
                    starDenied = denied;
                } else {
                    starDenied = deniedByTable.getOrDefault(qualifier, denied);
                }
                if (!starDenied.isEmpty()) {
                    throw new NlqRejectedException(RejectionCode.PII_COLUMN_DENIED,
                            "SELECT * would expose a restricted column");
                }
                continue;
            }

            if (expr instanceof AllColumns) {
                if (!denied.isEmpty()) {
                    throw new NlqRejectedException(RejectionCode.PII_COLUMN_DENIED,
                            "SELECT * would expose a restricted column");
                }
                continue;
            }

            ColumnCollector collector = new ColumnCollector();
            expr.accept(collector, null);
            for (String columnName : collector.columnNames) {
                if (denied.contains(columnName)) {
                    throw new NlqRejectedException(RejectionCode.PII_COLUMN_DENIED,
                            "Column '" + columnName + "' is restricted");
                }
            }
        }
    }

    private static final class ColumnCollector extends ExpressionVisitorAdapter<Void> {
        final Set<String> columnNames = new HashSet<>();

        @Override
        public <S> Void visit(Column column, S context) {
            columnNames.add(SqlNames.normalizeColumn(column.getColumnName()));
            return super.visit(column, context);
        }
    }
}
