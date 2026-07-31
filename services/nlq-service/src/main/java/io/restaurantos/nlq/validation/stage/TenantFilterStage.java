package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.nlq.validation.RejectionCode;

/**
 * Stage 5 — THE critical stage (12-RESEARCH Pitfall 3; ROADMAP success criterion 3, verbatim: "a
 * query missing the tenant or branch filter is rejected").
 *
 * <p>{@code tenant_id = '<ctx.tenantId>'} is ANDed into the WHERE clause via the AST (never
 * string surgery), then the mutated SQL is re-parsed and re-walked to PROVE the predicate landed
 * at the outermost conjunctive level. If the proof cannot be constructed — for ANY reason,
 * including "this shape isn't one we support" — the query is rejected with
 * {@link RejectionCode#TENANT_FILTER_MISSING}. See {@link PredicateInjector} for the mechanism.
 */
public class TenantFilterStage {

    public String apply(String sql, QueryContext ctx) {
        return PredicateInjector.injectAndProve(sql, "tenant_id", ctx.tenantId(),
                RejectionCode.TENANT_FILTER_MISSING);
    }
}
