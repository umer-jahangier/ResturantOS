package io.restaurantos.reporting.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * Shared P95-latency evidence writer for RPT-01, used by both {@link ReportService} (catalog
 * reports) and {@link FbrTaxSummaryService} (the FBR Tax Summary) so every report run — named
 * catalog report or the FBR report — lands exactly one {@code report_run_log} row, with the same
 * failure-tolerant semantics: a logging failure must never fail the report itself.
 */
@Component
public class ReportRunLogger {

    private static final Logger log = LoggerFactory.getLogger(ReportRunLogger.class);

    private final JdbcTemplate postgresJdbcTemplate;
    private final ObjectMapper objectMapper;

    public ReportRunLogger(@Qualifier("jdbcTemplate") JdbcTemplate postgresJdbcTemplate,
                            @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.postgresJdbcTemplate = postgresJdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public void log(UUID tenantId, UUID branchId, String reportCode, Map<String, Object> params,
                     int rowCount, long durationMs, UUID runBy) {
        try {
            String paramsJson = objectMapper.writeValueAsString(params);
            postgresJdbcTemplate.update(
                    "INSERT INTO report_run_log "
                            + "(tenant_id, branch_id, report_code, params, row_count, duration_ms, run_by) "
                            + "VALUES (?, ?, ?, ?::jsonb, ?, ?, ?)",
                    tenantId, branchId, reportCode, paramsJson, rowCount, (int) durationMs, runBy);
        } catch (Exception e) {
            log.warn("Failed to write report_run_log for code={}: {}", reportCode, e.getMessage());
        }
    }
}
