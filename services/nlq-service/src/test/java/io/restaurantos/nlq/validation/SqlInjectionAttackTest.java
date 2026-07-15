package io.restaurantos.nlq.validation;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * The adversarial negative-control suite — the security evidence for NLQ-01 / ROADMAP success
 * criterion 3. Every case here asserts a SPECIFIC {@link RejectionCode}, not just "it threw" —
 * a validator that only proves "something went wrong" cannot be trusted to have gone wrong for
 * the RIGHT reason.
 *
 * <p>Governing rule (12-RESEARCH Pitfall 3): if the pipeline cannot PROVE a query is safe, it
 * MUST reject it. "Best effort, probably fine" is a cross-tenant data breach.
 */
class SqlInjectionAttackTest {

    private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BRANCH_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

    private final SqlValidationPipeline pipeline = TestPipelines.standard();

    private static QueryContext managerCtx() {
        return new QueryContext(TENANT_ID, BRANCH_ID, "MANAGER", false, USER_ID, null);
    }

    private static QueryContext limitedAnalystCtx() {
        return new QueryContext(TENANT_ID, BRANCH_ID, "LIMITED_ANALYST", false, USER_ID, null);
    }

    // ---------------------------------------------------------------------------------------
    // Write / DDL — must never reach the parse/table/PII/tenant stages. Whitelist, not blacklist:
    // every one of these fails simply because it is not a Select.
    // ---------------------------------------------------------------------------------------

    @Test
    void insertIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("INSERT INTO sales_order_facts VALUES (1)", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void updateIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("UPDATE sales_order_facts SET total_paisa = 0", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void deleteIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("DELETE FROM sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void dropIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("DROP TABLE sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void truncateIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("TRUNCATE TABLE sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void alterIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("ALTER TABLE sales_order_facts ADD COLUMN x Int8", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void createTableIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("CREATE TABLE pwned (x Int8) ENGINE=Memory", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void renameTableIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("RENAME TABLE sales_order_facts TO x", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void grantIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("GRANT SELECT ON *.* TO nlq_readonly", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void systemShutdownIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SYSTEM SHUTDOWN", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void optimizeTableIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("OPTIMIZE TABLE sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void withPrefixedDeleteIsRejectedNotJustPrefixMatchedAsSelect() {
        // A CTE can legally scope a DELETE ("WITH x AS (...) DELETE FROM ..."), not just a
        // SELECT — this is a genuine bypass attempt of the cheap `startsWith("WITH")` prefix
        // pre-check. Discovered via the Task 3 watched-RED control on the instanceof Select
        // whitelist (see 12-04-SUMMARY.md); added here rather than only proven transiently.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("WITH x AS (SELECT 1) DELETE FROM sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    // ---------------------------------------------------------------------------------------
    // Statement smuggling — the shape stage parses with CCJSqlParserUtil.parseStatements and
    // rejects on statement-list size, never by counting semicolons (a `;` inside a string
    // literal would false-positive; a comment-hidden one would false-negative).
    // ---------------------------------------------------------------------------------------

    @Test
    void multiStatementIsRejectedNotSilentlyTruncatedToTheFirst() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT 1; DROP TABLE sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void blockCommentObfuscationParsesAsASingleInertStatementAndIsRejectedForHavingNoTable() {
        // The block comment is genuinely inert (JSqlParser strips it) — this really is just
        // `SELECT 1`, a single, harmless statement. It is still rejected, but for an unrelated,
        // fail-closed reason: a SELECT that references no table cannot be proven table-safe.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT 1 /* ; DROP TABLE x */", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TABLE_NOT_ALLOWED);
    }

    @Test
    void lineCommentObfuscationIsARealTwoStatementSmugglingAttemptAndIsRejected() {
        // Unlike the block-comment case, `--` only comments to end-of-line: the `;` after the
        // newline is a REAL second statement. This is genuinely dangerous input, correctly
        // caught by the same multi-statement check as the plain `SELECT 1; DROP ...` case.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT 1 -- comment\n; DROP TABLE sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.SHAPE_INVALID);
    }

    @Test
    void trailingSemicolonAndWhitespaceIsBenignAndMustPass() {
        String sql = "SELECT total_paisa FROM sales_order_facts;   \n  ";

        String result = pipeline.validate(sql, managerCtx());

        assertThat(result).isNotBlank();
    }

    // ---------------------------------------------------------------------------------------
    // Tenant/branch evasion — the ones that matter most.
    // ---------------------------------------------------------------------------------------

    @Test
    void starSelectFromNonOwnerIsRejectedBecauseTheTableHasPiiColumns() {
        // sales_order_facts carries customer_id/cashier_id — a bare `*` would expose them.
        // Rejected before even reaching the tenant-filter stage: defense in depth.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT * FROM sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }

    @Test
    void anOrThatTriesToWidenTheTenantPredicateCannotEscapeTheInjectedAndFilter() {
        String sql = "SELECT total_paisa FROM sales_order_facts WHERE 1=1 OR tenant_id = '" + TENANT_ID + "'";

        String result = pipeline.validate(sql, managerCtx());

        // The caller's OR is preserved verbatim, but wrapped and ANDed with our own predicate at
        // the OUTERMOST level — it can widen nothing. The injected Column is table-qualified
        // (sales_order_facts.tenant_id), so the assertion matches on the qualified form.
        assertThat(result).contains("OR");
        assertThat(result).contains(") AND sales_order_facts.tenant_id = '" + TENANT_ID + "'");
    }

    @Test
    void unionWithAnUnfilteredSecondArmIsRejected() {
        String sql = "SELECT total_paisa FROM sales_order_facts WHERE tenant_id='" + TENANT_ID + "' "
                + "UNION ALL SELECT total_paisa FROM sales_order_facts";

        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate(sql, managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TENANT_FILTER_MISSING);
    }

    @Test
    void cteWithAnUnfilteredInnerSelectIsRejected() {
        String sql = "WITH x AS (SELECT total_paisa FROM sales_order_facts) SELECT total_paisa FROM x";

        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate(sql, managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TENANT_FILTER_MISSING);
    }

    @Test
    void subqueryInFromIsRejected() {
        String sql = "SELECT total_paisa FROM (SELECT total_paisa FROM sales_order_facts) t";

        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate(sql, managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TENANT_FILTER_MISSING);
    }

    @Test
    void correlatedInSubqueryReachingAnotherTableIsRejected() {
        String sql = "SELECT total_paisa FROM sales_order_facts WHERE order_id IN "
                + "(SELECT order_id FROM sales_item_facts)";

        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate(sql, managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TENANT_FILTER_MISSING);
    }

    // ---------------------------------------------------------------------------------------
    // Table allowlist.
    // ---------------------------------------------------------------------------------------

    @Test
    void systemUsersTableIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT name FROM system.users", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TABLE_NOT_ALLOWED);
    }

    @Test
    void ownNlqQueryLogTableIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT question FROM nlq_query_log", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TABLE_NOT_ALLOWED);
    }

    @Test
    void aRoleWhoseAllowlistExcludesATableIsRejectedForQueryingIt() {
        // LIMITED_ANALYST's allowlist (TestPipelines) is sales_order_facts only.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT input_tax_paisa FROM purchase_tax_facts", limitedAnalystCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.TABLE_NOT_ALLOWED);
    }

    @Test
    void fullyQualifiedAllowedTableIsNotDefeatedByTheDatabasePrefix() {
        String sql = "SELECT total_paisa FROM clickhouse_analytics.sales_order_facts";

        String result = pipeline.validate(sql, managerCtx());

        assertThat(result).isNotBlank();
    }

    // ---------------------------------------------------------------------------------------
    // PII deny-list.
    // ---------------------------------------------------------------------------------------

    @Test
    void selectingADenyListedColumnDirectlyIsRejected() {
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT customer_id FROM sales_order_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }

    @Test
    void aliasedTableStarCannotBypassTheDenyList() {
        // `t.*` where `t` is an alias for a table with a denied column — the qualifier is the
        // ALIAS, not the real table name, so a naive lookup would miss it. Discovered while
        // writing StageCoverageTest (see 12-04-SUMMARY.md); the alias is resolved back to the
        // FROM table so the star is still denied.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT t.* FROM sales_order_facts t", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }

    @Test
    void starExpansionCannotBypassTheDenyList() {
        // Same underlying rule as starSelectFromNonOwnerIsRejectedBecauseTheTableHasPiiColumns,
        // asserted against a second table to prove the star-expansion rule is general, not a
        // one-table special case.
        NlqRejectedException ex = assertThrows(NlqRejectedException.class,
                () -> pipeline.validate("SELECT * FROM till_session_facts", managerCtx()));
        assertThat(ex.code()).isEqualTo(RejectionCode.PII_COLUMN_DENIED);
    }
}
