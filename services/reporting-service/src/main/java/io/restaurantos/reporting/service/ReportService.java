package io.restaurantos.reporting.service;

import io.restaurantos.reporting.dto.ReportRequest;
import io.restaurantos.reporting.dto.ReportResultDto;
import io.restaurantos.reporting.exception.InvalidReportRangeException;
import io.restaurantos.reporting.report.ReportCatalog;
import io.restaurantos.reporting.report.ReportDefinition;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Runs named reports (12-05 Task 1) against ClickHouse with structurally tenant/branch-safe
 * binds. {@code tenant_id} is NEVER a request parameter — resolved solely from
 * {@link TenantContext#requireTenantId()}, the same "impossible-by-construction" isolation rule as
 * decision 10-10-B. {@code branch_id} scoping is likewise resolved server-side: a non-OWNER caller
 * cannot see another branch's rows no matter what {@code branchId} they pass, and an unscoped
 * (tenant-wide) run is only possible for OWNER.
 */
@Service
public class ReportService {

    /** Keeps the P95 evidence honest — an unbounded date range would make "latency" meaningless. */
    private static final int MAX_RANGE_DAYS = 400;

    private final ReportCatalog catalog;
    private final JdbcTemplate clickHouseJdbcTemplate;
    private final TenantContext tenantContext;
    private final ReportRunLogger reportRunLogger;

    public ReportService(ReportCatalog catalog,
                          @Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate,
                          TenantContext tenantContext,
                          ReportRunLogger reportRunLogger) {
        this.catalog = catalog;
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
        this.tenantContext = tenantContext;
        this.reportRunLogger = reportRunLogger;
    }

    public List<ReportDefinition> listReports() {
        return catalog.list();
    }

    public ReportResultDto run(String code, ReportRequest request) {
        ReportDefinition definition = catalog.find(code)
                .orElseThrow(() -> new ResourceNotFoundException("Report not found: " + code));

        validateRange(request.from(), request.to());

        UUID tenantId = tenantContext.requireTenantId();
        UUID callerBranchId = tenantContext.getBranchId().orElse(null);
        boolean owner = isOwner();
        UUID effectiveBranchId = resolveEffectiveBranchId(request.branchId(), callerBranchId, owner);

        long startNanos = System.nanoTime();
        List<Map<String, Object>> rows = effectiveBranchId != null
                ? clickHouseJdbcTemplate.queryForList(definition.sqlBranchScoped(),
                        tenantId, effectiveBranchId, request.from(), request.to())
                : clickHouseJdbcTemplate.queryForList(definition.sqlTenantWide(),
                        tenantId, request.from(), request.to());
        long durationMs = (System.nanoTime() - startNanos) / 1_000_000L;

        List<String> dataNotes = "sales-by-item".equals(code)
                ? List.of("COGS and margin require Inventory (Phase 8) and are not yet available")
                : List.of();

        reportRunLogger.log(tenantId, effectiveBranchId, code,
                Map.of("from", request.from().toString(), "to", request.to().toString()),
                rows.size(), durationMs, tenantContext.getUserId().orElse(null));

        return new ReportResultDto(code, definition.title(), definition.columns(), rows,
                rows.size(), durationMs, dataNotes);
    }

    /**
     * A requested {@code branchId} MUST be validated against the caller's own accessible
     * branches, never trusted verbatim — otherwise a caller could pass any branch UUID in the
     * request body. Only an OWNER may pass {@code null} to mean "all my branches" (tenant-wide,
     * no branch predicate); every other caller either matches their own JWT-issued branch or is
     * rejected outright.
     */
    private UUID resolveEffectiveBranchId(UUID requestedBranchId, UUID callerBranchId, boolean owner) {
        if (requestedBranchId != null) {
            if (!owner && !requestedBranchId.equals(callerBranchId)) {
                throw new PermissionDeniedException("You may only run reports scoped to your own branch");
            }
            return requestedBranchId;
        }
        return owner ? null : callerBranchId;
    }

    private boolean isOwner() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null) {
            return false;
        }
        Object principal = authentication.getPrincipal();
        return principal instanceof JwtClaims claims
                && claims.roles() != null
                && claims.roles().contains("OWNER");
    }

    private void validateRange(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new InvalidReportRangeException("'from' and 'to' are required");
        }
        if (from.isAfter(to)) {
            throw new InvalidReportRangeException("'from' must not be after 'to'");
        }
        long days = ChronoUnit.DAYS.between(from, to);
        if (days > MAX_RANGE_DAYS) {
            throw new InvalidReportRangeException(
                    "date range spans " + days + " days, exceeding the max of " + MAX_RANGE_DAYS);
        }
    }
}
