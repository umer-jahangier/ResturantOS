package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.select.Select;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Direct, stage-level negative-branch coverage for the validation package — the defensive
 * "fail closed" paths a happy-path pipeline test never reaches. This is a security control; an
 * uncovered branch is an untested rejection path, so each one is exercised explicitly here.
 */
class StageCoverageTest {

    private static QueryContext ownerCtx() {
        return new QueryContext(UUID.randomUUID(), null, "OWNER", true, UUID.randomUUID(), null);
    }

    // ----- ShapeCheckStage -----

    @Test
    void shapeRejectsNull() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new ShapeCheckStage().validate(null));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void shapeRejectsBlank() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new ShapeCheckStage().validate("    \n  "));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void shapeRejectsOverLength() {
        String huge = "SELECT " + "a".repeat(4100) + " FROM sales_order_facts";
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new ShapeCheckStage().validate(huge));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void shapeRejectsSelectPrefixThatFailsToParse() {
        // Passes the cheap SELECT-prefix check, but parseStatements throws — must still be rejected.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new ShapeCheckStage().validate("SELECT 1 2 3"));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    // ----- AstParseStage -----

    @Test
    void astParseRejectsUnparseableSql() {
        // Exercises the lambda's JSQLParserException path AND the ExecutionException(Nlq-cause) rethrow.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new AstParseStage().parse("SELECT 1 2 3"));
        assertThat(ex.code()).isEqualTo(RejectionCode.PARSE_FAILED);
    }

    @Test
    void astParseRejectsNonSelectStandalone() {
        // Standalone (no ShapeCheckStage in front) a non-Select must still be rejected.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new AstParseStage().parse("DROP TABLE sales_order_facts"));
        assertThat(ex.code()).isEqualTo(RejectionCode.PARSE_FAILED);
    }

    @Test
    void astParseTimesOutWhenTheParseNeverCompletes() {
        // A no-op executor never runs the parse task, so future.get times out — proves a
        // pathological input cannot hang a request thread indefinitely.
        AstParseStage stage = new AstParseStage(runnable -> { /* deliberately never execute */ });
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> stage.parse("SELECT total_paisa FROM sales_order_facts"));
        assertThat(ex.code()).isEqualTo(RejectionCode.PARSE_FAILED);
    }

    // ----- LimitInjectStage -----

    private final LimitInjectStage limit = new LimitInjectStage(1000, 10000);

    @Test
    void limitRejectsUnparseableInput() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> limit.apply("SELECT 1 2 3"));
        assertThat(ex.code()).isEqualTo(RejectionCode.PARSE_FAILED);
    }

    @Test
    void limitRejectsNonPlainSelectShape() {
        // A set-operation (UNION) parses to a SetOperationList, not a PlainSelect.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> limit.apply("SELECT 1 FROM sales_order_facts UNION SELECT 1 FROM sales_item_facts"));
        assertThat(ex.code()).isEqualTo(RejectionCode.LIMIT_INVALID);
    }

    @Test
    void limitRejectsNonNumericLimit() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> limit.apply("SELECT total_paisa FROM sales_order_facts LIMIT length('x')"));
        assertThat(ex.code()).isEqualTo(RejectionCode.LIMIT_INVALID);
    }

    @Test
    void limitRejectsZeroLimit() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> limit.apply("SELECT total_paisa FROM sales_order_facts LIMIT 0"));
        assertThat(ex.code()).isEqualTo(RejectionCode.LIMIT_INVALID);
    }

    @Test
    void limitLeavesAnUnderCapLimitUntouched() {
        String result = limit.apply("SELECT total_paisa FROM sales_order_facts LIMIT 500");
        assertThat(result).contains("LIMIT 500");
    }

    // ----- PiiDenylistStage -----

    @Test
    void piiConstructorSkipsMalformedPairsWithoutADot() throws JSQLParserException {
        // "no_dot_here" has no '.', so it is skipped by the constructor (no crash, no entry).
        PiiDenylistStage stage = new PiiDenylistStage(List.of("no_dot_here", "sales_order_facts.customer_id"));
        Select select = (Select) CCJSqlParserUtil.parse("SELECT customer_id FROM sales_order_facts");
        NlqRejectedException ex = assertThrows(NlqRejectedException.class, () -> stage.validate(select));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }

    @Test
    void piiRejectsTableQualifiedStarThatExpandsToPii() throws JSQLParserException {
        // `t.*` (AllTableColumns) over a table with a denied column must be rejected too.
        PiiDenylistStage stage = new PiiDenylistStage(List.of("sales_order_facts.customer_id"));
        Select select = (Select) CCJSqlParserUtil.parse("SELECT t.* FROM sales_order_facts t");
        NlqRejectedException ex = assertThrows(NlqRejectedException.class, () -> stage.validate(select));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }

    @Test
    void piiIsANoOpForNonPlainSelectShapes() throws JSQLParserException {
        // A UNION is not a PlainSelect — PII analysis is a deliberate no-op here (the query is
        // rejected downstream by the tenant-filter stage regardless).
        PiiDenylistStage stage = new PiiDenylistStage(List.of("sales_order_facts.customer_id"));
        Select select = (Select) CCJSqlParserUtil.parse(
                "SELECT 1 FROM sales_order_facts UNION SELECT 1 FROM sales_item_facts");
        stage.validate(select); // must not throw
    }

    @Test
    void piiAllowsATableQualifiedStarOverATableWithNoDeniedColumns() throws JSQLParserException {
        PiiDenylistStage stage = new PiiDenylistStage(List.of("sales_order_facts.customer_id"));
        Select select = (Select) CCJSqlParserUtil.parse("SELECT t.* FROM sales_item_facts t");
        stage.validate(select); // sales_item_facts has no denied column → must not throw
    }

    @Test
    void piiStarWithAQualifierThatIsNeitherTheAliasNorTheTableFallsBackToDenyListLookup() throws JSQLParserException {
        // Qualifier `other` matches neither the alias `t` nor the table name — exercises the
        // else-branch that falls back to a direct deny-list lookup (defaulting to the FROM table's
        // denied set, so it still fails closed over a table that has PII).
        PiiDenylistStage stage = new PiiDenylistStage(List.of("sales_order_facts.customer_id"));
        Select select = (Select) CCJSqlParserUtil.parse("SELECT other.* FROM sales_order_facts t");
        NlqRejectedException ex = assertThrows(NlqRejectedException.class, () -> stage.validate(select));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }

    // ----- BranchFilterStage -----

    @Test
    void branchFilterIsAPassthroughForOwners() {
        String sql = "SELECT total_paisa FROM sales_order_facts WHERE tenant_id = '"
                + ownerCtx().tenantId() + "'";
        String result = new BranchFilterStage().apply(sql, ownerCtx());
        assertThat(result).isEqualTo(sql);
    }

    @Test
    void branchFilterRejectsANonOwnerWithNoBranchContext() {
        QueryContext noBranch = new QueryContext(UUID.randomUUID(), null, "MANAGER", false,
                UUID.randomUUID(), null);
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> new BranchFilterStage().apply("SELECT 1 FROM sales_order_facts", noBranch));
        assertThat(ex.code()).isEqualTo(RejectionCode.BRANCH_FILTER_MISSING);
    }

    // ----- SqlNames -----

    @Test
    void sqlNamesReturnNullForNullInput() {
        assertThat(SqlNames.normalizeTable(null)).isNull();
        assertThat(SqlNames.normalizeColumn(null)).isNull();
    }
}
