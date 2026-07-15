package io.restaurantos.nlq.validation;

import io.restaurantos.nlq.validation.stage.AstParseStage;
import io.restaurantos.nlq.validation.stage.BranchFilterStage;
import io.restaurantos.nlq.validation.stage.LimitInjectStage;
import io.restaurantos.nlq.validation.stage.PiiDenylistStage;
import io.restaurantos.nlq.validation.stage.ShapeCheckStage;
import io.restaurantos.nlq.validation.stage.TableAllowlistStage;
import io.restaurantos.nlq.validation.stage.TenantFilterStage;
import net.sf.jsqlparser.statement.select.Select;

/**
 * The 7-stage SQL AST validation pipeline that stands between Claude's generated SQL and the
 * database (plan 12-04 / NLQ-01 / ROADMAP success criterion 3). Pure, I/O-free except the
 * allowlist lookup ({@link TableAllowlistStage}, Redis-cached).
 *
 * <p>{@link #validate(String, QueryContext)} runs, in order:
 * <ol>
 *   <li>{@link ShapeCheckStage} — single SELECT/WITH statement, cheap structural gate.
 *   <li>{@link AstParseStage} — real JSqlParser AST parse, bounded parse time.
 *   <li>{@link TableAllowlistStage} — every table reference on the caller's role allowlist.
 *   <li>{@link PiiDenylistStage} — no deny-listed column, including via {@code SELECT *}.
 *   <li>{@link TenantFilterStage} — {@code tenant_id} ANDed in and PROVEN by re-parse.
 *   <li>{@link BranchFilterStage} — {@code branch_id} ANDed in for non-OWNERs, same proof.
 *   <li>{@link LimitInjectStage} — LIMIT injected or clamped.
 * </ol>
 * Any stage may throw {@link NlqRejectedException}. No Claude call, no ClickHouse execution —
 * those belong to plan 12-07.
 */
public class SqlValidationPipeline {

    private final ShapeCheckStage shapeCheckStage;
    private final AstParseStage astParseStage;
    private final TableAllowlistStage tableAllowlistStage;
    private final PiiDenylistStage piiDenylistStage;
    private final TenantFilterStage tenantFilterStage;
    private final BranchFilterStage branchFilterStage;
    private final LimitInjectStage limitInjectStage;

    public SqlValidationPipeline(ShapeCheckStage shapeCheckStage, AstParseStage astParseStage,
                                  TableAllowlistStage tableAllowlistStage, PiiDenylistStage piiDenylistStage,
                                  TenantFilterStage tenantFilterStage, BranchFilterStage branchFilterStage,
                                  LimitInjectStage limitInjectStage) {
        this.shapeCheckStage = shapeCheckStage;
        this.astParseStage = astParseStage;
        this.tableAllowlistStage = tableAllowlistStage;
        this.piiDenylistStage = piiDenylistStage;
        this.tenantFilterStage = tenantFilterStage;
        this.branchFilterStage = branchFilterStage;
        this.limitInjectStage = limitInjectStage;
    }

    /**
     * @return SQL that is safe to execute against {@code nlq_readonly} (plan 12-02) — or throws.
     */
    public String validate(String sql, QueryContext ctx) {
        shapeCheckStage.validate(sql);

        Select select = astParseStage.parse(sql);

        tableAllowlistStage.validate(select, ctx);
        piiDenylistStage.validate(select);

        String withTenant = tenantFilterStage.apply(sql, ctx);
        String withBranch = branchFilterStage.apply(withTenant, ctx);
        return limitInjectStage.apply(withBranch);
    }
}
