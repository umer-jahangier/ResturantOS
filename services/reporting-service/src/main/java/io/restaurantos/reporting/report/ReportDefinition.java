package io.restaurantos.reporting.report;

import java.util.List;

/**
 * A named, honestly-backed report against the ClickHouse fact tables (12-02).
 *
 * <p>{@code sqlBranchScoped} and {@code sqlTenantWide} are ALWAYS parameterised with {@code ?}
 * binds — never string-interpolated values. Two separate SQL strings exist (rather than one
 * "clever" {@code (? IS NULL OR branch_id = ?)} predicate) because ClickHouse's NULL-bind
 * semantics for that pattern were not obviously reliable to reason about without a live-container
 * check, and a query that enforces tenant/branch isolation should favour clarity over cleverness
 * (12-05-PLAN.md Task 1). {@code sqlTenantWide} is derived from {@code sqlBranchScoped} by
 * {@link ReportCatalog}, so the {@code tenant_id = ?} predicate is written exactly once per report
 * in source.
 *
 * <p>Bind order — {@code sqlBranchScoped}: {@code (tenantId, branchId, from, to)}.
 * {@code sqlTenantWide}: {@code (tenantId, from, to)}.
 */
public record ReportDefinition(
        String code,
        String title,
        String category,
        List<String> columns,
        String sqlBranchScoped,
        String sqlTenantWide) {
}
