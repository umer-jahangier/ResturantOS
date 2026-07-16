package io.restaurantos.reporting.dto;

import java.util.List;
import java.util.Map;

/**
 * Response shape for {@code POST /api/v1/reporting/reports/{code}/run}.
 *
 * <p>{@code dataNotes} carries human-readable degradation notices (e.g. COGS/margin being NULL
 * pending Phase 8) so the frontend can render "—" with an explanation instead of a misleading
 * zero, rather than the caller having to infer the reason from null cells alone.
 *
 * <p>{@code durationMs} is the same figure persisted to {@code report_run_log} — the P95-latency
 * evidence base for RPT-01 (see 12-05-SUMMARY.md's "Open Question" finding: no numeric P95 target
 * is defined anywhere in REQUIREMENTS.md/the spec; this field is how a future target gets
 * measured, not asserted).
 */
public record ReportResultDto(
        String code,
        String title,
        List<String> columns,
        List<Map<String, Object>> rows,
        int rowCount,
        long durationMs,
        List<String> dataNotes) {
}
