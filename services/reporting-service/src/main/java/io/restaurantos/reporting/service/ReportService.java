package io.restaurantos.reporting.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.dto.ReportRequest;
import io.restaurantos.reporting.dto.ReportResultDto;
import io.restaurantos.reporting.exception.InvalidReportRangeException;
import io.restaurantos.reporting.report.ReportCatalog;
import io.restaurantos.reporting.report.ReportDefinition;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);

    /** Keeps the P95 evidence honest — an unbounded date range would make "latency" meaningless. */
    private static final int MAX_RANGE_DAYS = 400;

    private final ReportCatalog catalog;
    private final JdbcTemplate clickHouseJdbcTemplate;
    private final JdbcTemplate postgresJdbcTemplate;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public ReportService(ReportCatalog catalog,
                          @Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate,
                          @Qualifier("jdbcTemplate") JdbcTemplate postgresJdbcTemplate,
                          TenantContext tenantContext,
                          @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.catalog = catalog;
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
        this.postgresJdbcTemplate = postgresJdbcTemplate;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
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

        logRun(tenantId, effectiveBranchId, code, request, rows.size(), durationMs);

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

    /**
     * The P95-latency evidence for RPT-01: every run records tenant/branch/code/params/row-count
     * /duration to Postgres {@code report_run_log} (RLS FORCEd, V1__reporting_schema.sql). A
     * logging failure must never fail the report itself — the report succeeded and the caller
     * already has their data; a log-write hiccup is degraded observability, not a user-facing
     * error.
     */
    private void logRun(UUID tenantId, UUID branchId, String code, ReportRequest request,
                         int rowCount, long durationMs) {
        try {
            String paramsJson = objectMapper.writeValueAsString(Map.of(
                    "from", request.from().toString(),
                    "to", request.to().toString()));
            UUID runBy = tenantContext.getUserId().orElse(null);
            postgresJdbcTemplate.update(
                    "INSERT INTO report_run_log "
                            + "(tenant_id, branch_id, report_code, params, row_count, duration_ms, run_by) "
                            + "VALUES (?, ?, ?, ?::jsonb, ?, ?, ?)",
                    tenantId, branchId, code, paramsJson, rowCount, (int) durationMs, runBy);
        } catch (Exception e) {
            log.warn("Failed to write report_run_log for code={}: {}", code, e.getMessage());
        }
    }
}
