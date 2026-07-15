package io.restaurantos.nlq.validation;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Contract tests for {@link SqlValidationPipeline} — the happy-path behaviour every generated
 * query must exhibit. See {@link SqlInjectionAttackTest} for the adversarial negative controls.
 */
class SqlValidationPipelineTest {

    private static final UUID TENANT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_TENANT_ID = UUID.fromString("99999999-9999-9999-9999-999999999999");
    private static final UUID BRANCH_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

    private final SqlValidationPipeline pipeline = TestPipelines.standard();

    private static QueryContext managerCtx() {
        return new QueryContext(TENANT_ID, BRANCH_ID, "MANAGER", false, USER_ID, null);
    }

    private static QueryContext ownerCtx() {
        return new QueryContext(TENANT_ID, null, "OWNER", true, USER_ID, null);
    }

    @Test
    void nonOwnerQueryCarriesBothTenantAndBranchPredicatesAndALimit() {
        String sql = "SELECT sum(total_paisa) FROM sales_order_facts WHERE business_date >= '2026-07-01'";

        String result = pipeline.validate(sql, managerCtx());

        assertThat(result).contains("tenant_id = '" + TENANT_ID + "'");
        assertThat(result).contains("branch_id = '" + BRANCH_ID + "'");
        assertThat(result).containsIgnoringCase("LIMIT");
    }

    @Test
    void ownerQueryCarriesTenantOnlyNotForcedToASingleBranch() {
        String sql = "SELECT sum(total_paisa) FROM sales_order_facts WHERE business_date >= '2026-07-01'";

        String result = pipeline.validate(sql, ownerCtx());

        assertThat(result).contains("tenant_id = '" + TENANT_ID + "'");
        assertThat(result).doesNotContain("branch_id");
        assertThat(result).containsIgnoringCase("LIMIT");
    }

    @Test
    void alreadyTenantFilteredQueryIsNotDoubleFilteredIntoContradiction() {
        String sql = "SELECT total_paisa FROM sales_order_facts WHERE tenant_id = '" + TENANT_ID + "'";

        String result = pipeline.validate(sql, managerCtx());

        // Still governed by the caller's own tenant predicate — not widened, not contradicted.
        assertThat(result).contains("tenant_id = '" + TENANT_ID + "'");
    }

    @Test
    void namingAnotherTenantsIdNeverWidensTheFilter() {
        String sql = "SELECT total_paisa FROM sales_order_facts WHERE tenant_id = '" + OTHER_TENANT_ID + "'";

        // Never rejected outright — but the caller's OWN tenant predicate must be present and
        // conjunctive (ANDed), never something an OR could escape.
        String result = pipeline.validate(sql, managerCtx());

        assertThat(result).contains("tenant_id = '" + TENANT_ID + "'");
        assertThat(result).contains("AND");
    }

    @Test
    void limitAboveCapIsClampedDown() {
        String sql = "SELECT total_paisa FROM sales_order_facts LIMIT 999999";

        String result = pipeline.validate(sql, managerCtx());

        assertThat(result).contains("LIMIT " + TestPipelines.MAX_RESULT_ROWS);
        assertThat(result).doesNotContain("LIMIT 999999");
    }

    @Test
    void missingLimitGetsTheDefaultInjected() {
        String sql = "SELECT total_paisa FROM sales_order_facts";

        String result = pipeline.validate(sql, managerCtx());

        assertThat(result).contains("LIMIT " + TestPipelines.DEFAULT_LIMIT);
    }

    @Test
    void joinAcrossTwoAllowedFactTablesIsRejectedRatherThanRiskAnUnprovableFilter() {
        // A JOIN where only one side could be proven tenant-filtered would be a cross-tenant leak.
        // This pipeline's supported shape is deliberately a single table (see PredicateInjector) —
        // a JOIN is rejected outright rather than risk a partially-filtered result.
        String sql = "SELECT o.total_paisa FROM sales_order_facts o "
                + "JOIN sales_item_facts i ON o.order_id = i.order_id";

        assertThatThrownBy(() -> pipeline.validate(sql, managerCtx()))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.TENANT_FILTER_MISSING));
    }
}
