package io.restaurantos.nlq.execution;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.StatementCallback;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The second line of defence behind {@code SqlValidationPipeline} (plan 12-04): runs
 * validator-approved SQL as the {@code nlq_readonly} ClickHouse user (plan 12-02), which is
 * empirically proven unable to INSERT/DROP/CREATE, read an ungranted table, exceed its row cap, or
 * exceed its execution-time ceiling — even if the AST validator were ever bypassed.
 *
 * <p>Belt and braces on top of the server-side {@code nlq_readonly_profile}
 * ({@code max_execution_time = 5 MAX 5}, {@code max_result_rows = 10000 MAX 10000},
 * {@code result_overflow_mode = 'throw' CONST}, all CONST/MAX-bound so the client cannot relax
 * them): the JDBC {@code queryTimeout} is set (see {@code ClickHouseReadOnlyConfig}), and this
 * class additionally fetches one row beyond the configured cap so a breach can be detected and
 * rejected client-side too, in case the server-side profile is ever misconfigured.
 *
 * <p>A row-cap breach or a timeout ALWAYS surfaces as a typed exception — never a silently
 * truncated result presented as complete.
 */
@Component
public class ClickHouseReadOnlyExecutor {

    private static final Logger log = LoggerFactory.getLogger(ClickHouseReadOnlyExecutor.class);

    private final JdbcTemplate jdbcTemplate;
    private final long maxResultRows;

    public ClickHouseReadOnlyExecutor(
            @Qualifier("clickHouseReadOnlyJdbcTemplate") JdbcTemplate jdbcTemplate,
            @Value("${restaurantos.nlq.max-result-rows}") long maxResultRows) {
        this.jdbcTemplate = jdbcTemplate;
        this.maxResultRows = maxResultRows;
    }

    /**
     * @param sql SQL that has ALREADY been through {@code SqlValidationPipeline.validate(...)}.
     *            This class trusts its caller on that point — it is not itself a validator.
     * @throws NlqTimeoutException          if the query exceeds the configured wall-clock ceiling.
     * @throws NlqRowCapExceededException   if the result would exceed the configured row cap.
     */
    public ExecutionResult execute(String sql) {
        long start = System.currentTimeMillis();
        try {
            List<Map<String, Object>> rows = jdbcTemplate.execute((StatementCallback<List<Map<String, Object>>>) stmt -> {
                // Fetch one row beyond the cap so a breach is DETECTABLE (never silently
                // truncated to exactly the cap and returned as if complete).
                long capPlusOne = maxResultRows + 1;
                stmt.setMaxRows(capPlusOne > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) capPlusOne);
                try (ResultSet rs = stmt.executeQuery(sql)) {
                    return extractRows(rs);
                }
            });
            long elapsedMs = System.currentTimeMillis() - start;

            if (rows.size() > maxResultRows) {
                throw new NlqRowCapExceededException(
                        "Result exceeds the " + maxResultRows + "-row cap — narrow your question");
            }
            return new ExecutionResult(rows, rows.size(), elapsedMs);
        } catch (NlqRowCapExceededException | NlqTimeoutException ex) {
            throw ex;
        } catch (DataAccessException ex) {
            throw classify(ex);
        }
    }

    /**
     * ClickHouse's HTTP/JDBC driver surfaces the server's {@code readonly} profile violations as
     * plain {@link SQLException}s carrying the server's error text (see 12-02-SUMMARY's verbatim
     * server output) rather than distinctly-typed Spring {@code DataAccessException} subclasses —
     * classify by message content, never by guessing.
     */
    private RuntimeException classify(DataAccessException ex) {
        String message = fullMessage(ex);
        if (message.contains("TIMEOUT_EXCEEDED") || message.contains("Code: 159")
                || message.toLowerCase().contains("timeout")) {
            log.warn("[nlq-executor] Query exceeded the timeout ceiling");
            return new NlqTimeoutException("Query exceeded the execution time limit — narrow your question", ex);
        }
        if (message.contains("TOO_MANY_ROWS_OR_BYTES") || message.contains("Code: 396")
                || message.contains("Limit for result exceeded")) {
            log.warn("[nlq-executor] Query exceeded the row cap at the ClickHouse server");
            return new NlqRowCapExceededException(
                    "Result exceeds the " + maxResultRows + "-row cap — narrow your question", ex);
        }
        return ex;
    }

    private static String fullMessage(Throwable ex) {
        StringBuilder sb = new StringBuilder();
        Throwable current = ex;
        while (current != null) {
            if (current.getMessage() != null) {
                sb.append(current.getMessage()).append(' ');
            }
            current = current.getCause();
        }
        return sb.toString();
    }

    private static List<Map<String, Object>> extractRows(ResultSet rs) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        int columnCount = meta.getColumnCount();
        List<Map<String, Object>> rows = new ArrayList<>();
        while (rs.next()) {
            Map<String, Object> row = new LinkedHashMap<>(columnCount);
            for (int i = 1; i <= columnCount; i++) {
                row.put(meta.getColumnLabel(i), rs.getObject(i));
            }
            rows.add(row);
        }
        return rows;
    }
}
