package io.restaurantos.nlq.dto;

import java.util.List;
import java.util.Map;

/**
 * @param question   the caller's original question, echoed back for display convenience.
 * @param sql         the EXECUTED SQL — post-validation, tenant/branch-scoped, LIMIT-bounded. Safe
 *                    to return: it is exactly what ran, never the raw pre-validation Claude output,
 *                    and returning it is what makes the feature auditable/trustworthy to the caller.
 * @param rows        each row as an ordered column -&gt; value map.
 * @param columns     the column names, in result order (derived from {@code rows}; empty if no rows).
 * @param rowCount    {@code rows.size()}.
 * @param narrative   a best-effort plain-English summary from Claude Haiku, or {@code null} if
 *                    narration failed or was skipped — a narration failure never fails the request.
 * @param cacheHit    whether this response was served from the 60s result cache without a fresh
 *                    Claude call or ClickHouse execution.
 * @param durationMs  wall-clock time spent executing the query (0 on a cache hit).
 */
public record NlqQueryResponse(
        String question,
        String sql,
        List<Map<String, Object>> rows,
        List<String> columns,
        int rowCount,
        String narrative,
        boolean cacheHit,
        long durationMs) {
}
