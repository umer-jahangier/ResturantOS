package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.Statements;
import net.sf.jsqlparser.statement.select.Select;

/**
 * Stage 1 — a cheap structural gate BEFORE the real AST parse.
 *
 * <p>Whitelist, never blacklist: we reject anything that is not, after parsing, a single
 * {@link Select} statement. ClickHouse has verbs ({@code OPTIMIZE}, {@code SYSTEM}, ...) a
 * blacklist would never think to enumerate.
 */
public class ShapeCheckStage {

    /** Sane cap — a legitimate analytics question does not need a 4000+ character SQL body. */
    private static final int MAX_SQL_LENGTH = 4000;

    public void validate(String sql) {
        if (sql == null) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "SQL must not be empty");
        }
        String trimmed = sql.trim();
        if (trimmed.isEmpty()) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "SQL must not be empty");
        }
        if (trimmed.length() > MAX_SQL_LENGTH) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "SQL exceeds maximum allowed length");
        }

        String upperPrefix = trimmed.substring(0, Math.min(trimmed.length(), 10)).toUpperCase(java.util.Locale.ROOT);
        if (!(upperPrefix.startsWith("SELECT") || upperPrefix.startsWith("WITH"))) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "Only SELECT/WITH statements are permitted");
        }

        // Parse (not regex/semicolon-counting) to detect multi-statement smuggling: a `;` inside a
        // string literal must not false-positive, and a comment-hidden one must not false-negative.
        Statements statements;
        try {
            statements = CCJSqlParserUtil.parseStatements(trimmed);
        } catch (JSQLParserException ex) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "SQL could not be parsed as a single statement");
        }
        if (statements == null || statements.size() != 1) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "Only a single statement is permitted");
        }

        Statement statement = statements.get(0);
        if (!(statement instanceof Select)) {
            throw new NlqRejectedException(RejectionCode.SHAPE_INVALID, "Only SELECT statements are permitted");
        }
    }
}
