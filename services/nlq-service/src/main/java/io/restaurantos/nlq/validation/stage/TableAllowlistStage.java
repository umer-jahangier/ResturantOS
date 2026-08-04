package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.allowlist.AllowedTableService;
import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.util.TablesNamesFinder;

import java.util.Set;

/**
 * Stage 3 — every table reference (top-level, inside CTEs, subqueries, UNION arms — this is
 * exactly why we walk the AST instead of regexing the SQL) must be on the caller's role-scoped
 * allowlist ({@link AllowedTableService}, Redis-cached).
 */
public class TableAllowlistStage {

    private final AllowedTableService allowedTableService;

    public TableAllowlistStage(AllowedTableService allowedTableService) {
        this.allowedTableService = allowedTableService;
    }

    public void validate(Select select, QueryContext ctx) {
        TablesNamesFinder<Void> finder = new TablesNamesFinder<>();
        Set<String> rawTableNames = finder.getTables((Statement) select);

        if (rawTableNames.isEmpty()) {
            // Fail closed: if we cannot enumerate the tables this query touches, we cannot prove
            // it is safe to run.
            throw new NlqRejectedException(RejectionCode.TABLE_NOT_ALLOWED,
                    "Could not determine which tables this query references");
        }

        Set<String> allowed = allowedTableService.allowedFor(ctx.roleCode());

        for (String raw : rawTableNames) {
            String normalized = SqlNames.normalizeTable(raw);
            if (!allowed.contains(normalized)) {
                throw new NlqRejectedException(RejectionCode.TABLE_NOT_ALLOWED,
                        "Table '" + normalized + "' is not permitted for this role");
            }
        }
    }
}
