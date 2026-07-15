package io.restaurantos.nlq.validation;

import io.restaurantos.nlq.allowlist.AllowedTableEntity;
import io.restaurantos.nlq.allowlist.AllowedTableRepository;
import io.restaurantos.nlq.allowlist.AllowedTableService;
import io.restaurantos.nlq.validation.stage.AstParseStage;
import io.restaurantos.nlq.validation.stage.BranchFilterStage;
import io.restaurantos.nlq.validation.stage.LimitInjectStage;
import io.restaurantos.nlq.validation.stage.PiiDenylistStage;
import io.restaurantos.nlq.validation.stage.ShapeCheckStage;
import io.restaurantos.nlq.validation.stage.TableAllowlistStage;
import io.restaurantos.nlq.validation.stage.TenantFilterStage;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Test-only wiring: a real {@link SqlValidationPipeline} backed by an in-memory (Mockito-stubbed)
 * {@link AllowedTableRepository} — no Postgres, no Redis. The pipeline is pure/I-O-free apart
 * from the allowlist lookup, so this is a faithful unit-test double, not a shortcut.
 */
final class TestPipelines {

    private TestPipelines() {
    }

    static final long DEFAULT_LIMIT = 1000;
    static final long MAX_RESULT_ROWS = 10000;

    /** Matches application.yml's restaurantos.nlq.pii-denylist. */
    static final List<String> PII_DENYLIST = List.of(
            "sales_order_facts.customer_id",
            "sales_order_facts.cashier_id",
            "till_session_facts.cashier_id"
    );

    static final Set<String> ALL_FACT_TABLES = Set.of(
            "sales_order_facts", "sales_item_facts", "purchase_tax_facts", "till_session_facts");

    static SqlValidationPipeline build(Map<String, Set<String>> allowlistByRole) {
        AllowedTableRepository repo = mock(AllowedTableRepository.class);
        when(repo.findByRoleCode(anyString())).thenAnswer(invocation -> {
            String role = invocation.getArgument(0);
            Set<String> tables = allowlistByRole.getOrDefault(role, Set.of());
            return tables.stream()
                    .map(t -> new AllowedTableEntity(role, t))
                    .collect(Collectors.toList());
        });
        AllowedTableService allowedTableService = new AllowedTableService(repo, null);

        return new SqlValidationPipeline(
                new ShapeCheckStage(),
                new AstParseStage(),
                new TableAllowlistStage(allowedTableService),
                new PiiDenylistStage(PII_DENYLIST),
                new TenantFilterStage(),
                new BranchFilterStage(),
                new LimitInjectStage(DEFAULT_LIMIT, MAX_RESULT_ROWS)
        );
    }

    /** OWNER/MANAGER/ACCOUNTANT get all four fact tables; CASHIER gets none — matches V1__nlq_schema.sql. */
    static SqlValidationPipeline standard() {
        return build(Map.of(
                "OWNER", ALL_FACT_TABLES,
                "MANAGER", ALL_FACT_TABLES,
                "ACCOUNTANT", ALL_FACT_TABLES,
                "CASHIER", Set.of(),
                "LIMITED_ANALYST", Set.of("sales_order_facts")
        ));
    }
}
