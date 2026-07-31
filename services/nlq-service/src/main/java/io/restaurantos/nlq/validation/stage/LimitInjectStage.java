package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.LongValue;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Limit;
import net.sf.jsqlparser.statement.select.PlainSelect;

/**
 * Stage 7 — the polite first line of defence. No LIMIT gets {@code nlq.default-limit} injected;
 * a LIMIT above {@code nlq.max-result-rows} is clamped down; a negative/zero/non-numeric LIMIT is
 * rejected. The {@code nlq_readonly} ClickHouse profile (plan 12-02) is the hard line — both
 * exist on purpose.
 */
public class LimitInjectStage {

    private final long defaultLimit;
    private final long maxResultRows;

    public LimitInjectStage(long defaultLimit, long maxResultRows) {
        this.defaultLimit = defaultLimit;
        this.maxResultRows = maxResultRows;
    }

    public String apply(String sql) {
        Statement statement;
        try {
            statement = CCJSqlParserUtil.parse(sql);
        } catch (JSQLParserException ex) {
            throw new NlqRejectedException(RejectionCode.PARSE_FAILED, "Could not re-parse the query to apply LIMIT");
        }
        if (!(statement instanceof PlainSelect plainSelect)) {
            // Every prior stage already restricts us to this shape by the time we get here.
            throw new NlqRejectedException(RejectionCode.LIMIT_INVALID, "Unsupported query shape for LIMIT");
        }

        Limit limit = plainSelect.getLimit();
        if (limit == null) {
            Limit injected = new Limit();
            injected.setRowCount(new LongValue(defaultLimit));
            plainSelect.setLimit(injected);
            return plainSelect.toString();
        }

        Expression rowCount = limit.getRowCount();
        if (!(rowCount instanceof LongValue longValue)) {
            throw new NlqRejectedException(RejectionCode.LIMIT_INVALID, "LIMIT must be a literal integer");
        }
        long requested = longValue.getValue();
        if (requested <= 0) {
            throw new NlqRejectedException(RejectionCode.LIMIT_INVALID, "LIMIT must be a positive integer");
        }
        if (requested > maxResultRows) {
            limit.setRowCount(new LongValue(maxResultRows));
        }
        return plainSelect.toString();
    }
}
