package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.nlq.validation.RejectionCode;

/**
 * Stage 6 — identical mechanism to {@link TenantFilterStage}, applied ONLY when the caller is
 * not an OWNER. OWNER-role users may legitimately query across branches (they get the tenant
 * filter only, from Stage 5).
 *
 * <p>A non-OWNER with no {@code branchId} on their context cannot be scoped at all — they get
 * nothing, not an unfiltered query.
 */
public class BranchFilterStage {

    public String apply(String sql, QueryContext ctx) {
        if (ctx.isOwner()) {
            return sql;
        }
        if (ctx.branchId() == null) {
            throw new NlqRejectedException(RejectionCode.BRANCH_FILTER_MISSING,
                    "A branch-scoped role must have a branch context to run analytics queries");
        }
        return PredicateInjector.injectAndProve(sql, "branch_id", ctx.branchId(),
                RejectionCode.BRANCH_FILTER_MISSING);
    }
}
