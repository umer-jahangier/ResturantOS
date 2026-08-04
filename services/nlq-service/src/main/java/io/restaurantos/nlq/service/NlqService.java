package io.restaurantos.nlq.service;

import io.restaurantos.nlq.audit.NlqQueryLogService;
import io.restaurantos.nlq.cache.NlqResultCache;
import io.restaurantos.nlq.claude.ClaudeClient;
import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import io.restaurantos.nlq.claude.SchemaPromptBuilder;
import io.restaurantos.nlq.dto.NlqQueryResponse;
import io.restaurantos.nlq.execution.ClickHouseReadOnlyExecutor;
import io.restaurantos.nlq.execution.ExecutionResult;
import io.restaurantos.nlq.execution.NlqRowCapExceededException;
import io.restaurantos.nlq.execution.NlqTimeoutException;
import io.restaurantos.nlq.quota.NlqQuotaService;
import io.restaurantos.nlq.quota.QuotaExceededException;
import io.restaurantos.nlq.quota.QuotaServiceUnavailableException;
import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.nlq.validation.SqlValidationPipeline;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The NLQ orchestration — the ONLY code path from a natural-language question to ClickHouse.
 *
 * <pre>
 * 1. Reserve quota (monthly tenant + hourly user).       -&gt; QuotaExceededException / 429
 * 2. Cache lookup.                                        -&gt; HIT: rollback quota, return.
 * 3. Build role-scoped schema prompt; call Claude.        -&gt; ClaudeUnavailableException / 503
 * 4. sqlValidationPipeline.validate(rawSql, ctx).          -&gt; NlqRejectedException / 400
 * 5. Execute via ClickHouseReadOnlyExecutor (nlq_readonly, 5s, row cap).
 * 6. Narrate via Claude Haiku — BEST EFFORT, never fails the request.
 * 7. Cache the result (60s). Audit with executed_sql/row_count/duration_ms.
 * 8. Return.
 * </pre>
 *
 * <p>Every outcome — success, quota rejection, cache hit, Claude failure, validator rejection,
 * execution failure — writes exactly one {@code nlq_query_log} row. Nothing that fails validation
 * is EVER executed; there is no bypass, no admin override, no debug flag that skips it.
 */
@Service
public class NlqService {

    private static final Logger log = LoggerFactory.getLogger(NlqService.class);

    private final NlqQuotaService quotaService;
    private final NlqResultCache resultCache;
    private final SchemaPromptBuilder schemaPromptBuilder;
    private final ClaudeClient claudeClient;
    private final SqlValidationPipeline sqlValidationPipeline;
    private final ClickHouseReadOnlyExecutor executor;
    private final NlqQueryLogService queryLogService;

    public NlqService(NlqQuotaService quotaService, NlqResultCache resultCache,
                       SchemaPromptBuilder schemaPromptBuilder, ClaudeClient claudeClient,
                       SqlValidationPipeline sqlValidationPipeline, ClickHouseReadOnlyExecutor executor,
                       NlqQueryLogService queryLogService) {
        this.quotaService = quotaService;
        this.resultCache = resultCache;
        this.schemaPromptBuilder = schemaPromptBuilder;
        this.claudeClient = claudeClient;
        this.sqlValidationPipeline = sqlValidationPipeline;
        this.executor = executor;
        this.queryLogService = queryLogService;
    }

    public NlqQueryResponse query(String question, QueryContext ctx) {
        // 1. Reserve quota BEFORE anything expensive.
        try {
            quotaService.reserve(ctx.tenantId(), ctx.userId());
        } catch (QuotaExceededException ex) {
            queryLogService.log(ctx, question, null, null,
                    "QUOTA_EXCEEDED_" + ex.quota().name(), null, null, false);
            throw ex;
        } catch (QuotaServiceUnavailableException ex) {
            // Redis unreachable: the reservation never happened, so there is nothing to roll
            // back — but the audit log still gets a row (an audit log that only records
            // successes is not an audit log), on the Postgres side which is unaffected.
            queryLogService.log(ctx, question, null, null, "QUOTA_SERVICE_UNAVAILABLE", null, null, false);
            throw ex;
        }

        // 2. Cache lookup — a hit costs the tenant nothing.
        String cacheKey = resultCache.keyFor(ctx, question);
        Optional<NlqResultCache.CachedResult> cached = resultCache.get(cacheKey);
        if (cached.isPresent()) {
            quotaService.rollback(ctx.tenantId(), ctx.userId());
            NlqResultCache.CachedResult hit = cached.get();
            queryLogService.log(ctx, question, null, hit.executedSql(), null, hit.rows().size(), 0, true);
            return toResponse(question, hit.executedSql(), hit.rows(), hit.narrative(), true, 0L);
        }

        // 3. Build the role-scoped schema prompt; call Claude for SQL.
        String rawSql;
        try {
            String schemaPrompt = schemaPromptBuilder.buildFor(ctx.roleCode());
            rawSql = claudeClient.generateSql(question, schemaPrompt);
        } catch (ClaudeUnavailableException ex) {
            quotaService.rollback(ctx.tenantId(), ctx.userId());
            queryLogService.log(ctx, question, null, null, "CLAUDE_UNAVAILABLE", null, null, false);
            throw ex;
        }

        // 4. THE gate. Every generated statement passes through here before ClickHouse ever sees it.
        String safeSql;
        try {
            safeSql = sqlValidationPipeline.validate(rawSql, ctx);
        } catch (NlqRejectedException ex) {
            quotaService.rollback(ctx.tenantId(), ctx.userId());
            queryLogService.log(ctx, question, rawSql, null, ex.code().name(), null, null, false);
            throw ex;
        }

        // 5. Execute as nlq_readonly (5s timeout, row cap) — reachable ONLY via the validated SQL
        //    above. Timeout/row-cap failures are NOT rolled back: Claude has already been called,
        //    so the quota unit is legitimately spent regardless of the downstream outcome.
        ExecutionResult result;
        try {
            result = executor.execute(safeSql);
        } catch (NlqTimeoutException ex) {
            queryLogService.log(ctx, question, rawSql, safeSql, "QUERY_TIMEOUT", null, null, false);
            throw ex;
        } catch (NlqRowCapExceededException ex) {
            queryLogService.log(ctx, question, rawSql, safeSql, "ROW_CAP_EXCEEDED", null, null, false);
            throw ex;
        }

        // 6. Narrate — best-effort. A narration failure returns the rows with a null narrative,
        //    it never fails the overall request. An EMPTY result is not narrated at all: there is
        //    nothing to describe, and it avoids spending a second Claude call on "no rows".
        String narrative = result.rows().isEmpty() ? null : tryNarrate(question, result.rows());

        // 7. Cache (60s) and audit the success.
        resultCache.put(cacheKey, new NlqResultCache.CachedResult(result.rows(), safeSql, narrative));
        queryLogService.log(ctx, question, rawSql, safeSql, null, result.rowCount(),
                (int) result.elapsedMs(), false);

        // 8. Return.
        return toResponse(question, safeSql, result.rows(), narrative, false, result.elapsedMs());
    }

    private String tryNarrate(String question, List<Map<String, Object>> rows) {
        try {
            return claudeClient.narrate(question, rows);
        } catch (RuntimeException ex) {
            log.warn("[nlq-service] Narration failed — returning rows with a null narrative", ex);
            return null;
        }
    }

    private static NlqQueryResponse toResponse(String question, String sql, List<Map<String, Object>> rows,
                                                String narrative, boolean cacheHit, long durationMs) {
        Set<String> columns = new LinkedHashSet<>();
        for (Map<String, Object> row : rows) {
            columns.addAll(row.keySet());
        }
        return new NlqQueryResponse(question, sql, rows, List.copyOf(columns), rows.size(),
                narrative, cacheHit, durationMs);
    }
}
