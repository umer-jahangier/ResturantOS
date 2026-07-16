package io.restaurantos.nlq.execution;

import java.util.List;
import java.util.Map;

/**
 * The result of executing validated SQL against {@code nlq_readonly}.
 *
 * @param rows      each row as an ordered column-name -&gt; value map (insertion order preserved by
 *                  {@link java.util.LinkedHashMap}, so column order round-trips to the API response).
 * @param rowCount  {@code rows.size()} — pulled out explicitly so callers don't re-derive it.
 * @param elapsedMs wall-clock time spent inside the JDBC call, for {@code nlq_query_log.duration_ms}.
 */
public record ExecutionResult(List<Map<String, Object>> rows, int rowCount, long elapsedMs) {
}
