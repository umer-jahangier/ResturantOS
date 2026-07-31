package io.restaurantos.nlq.audit;

import io.restaurantos.nlq.validation.QueryContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes one {@code nlq_query_log} row per request — success, validator rejection, quota
 * rejection, Claude failure, or timeout. Called for EVERY outcome (see {@code NlqService}).
 *
 * <p>{@code impersonated_by} is sourced from {@link QueryContext#impersonatedBy()}, which itself
 * is built by the controller ONLY from {@code JwtClaims.impersonatedBy()} — the validated JWT,
 * never a client-supplied header (a forgeable stamp is worthless audit).
 *
 * <p>Runs in its OWN transaction ({@code REQUIRES_NEW}) so a rejection/failure path still
 * persists its audit row even though the enclosing request transaction (if any) is about to be
 * rolled back or the request is about to fail.
 */
@Service
public class NlqQueryLogService {

    private static final Logger log = LoggerFactory.getLogger(NlqQueryLogService.class);

    private final NlqQueryLogRepository repository;

    public NlqQueryLogService(NlqQueryLogRepository repository) {
        this.repository = repository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(QueryContext ctx, String question, String generatedSql, String executedSql,
                     String rejectionCode, Integer rowCount, Integer durationMs, boolean cacheHit) {
        try {
            NlqQueryLogEntity entity = NlqQueryLogEntity.builder()
                    .tenantId(ctx.tenantId())
                    .branchId(ctx.branchId())
                    .userId(ctx.userId())
                    .impersonatedBy(ctx.impersonatedBy())
                    .roleCode(ctx.roleCode())
                    .question(question)
                    .generatedSql(generatedSql)
                    .executedSql(executedSql)
                    .rejectionCode(rejectionCode)
                    .rowCount(rowCount)
                    .durationMs(durationMs)
                    .cacheHit(cacheHit)
                    .build();
            repository.save(entity);
        } catch (RuntimeException ex) {
            // The audit write must never take the primary request path down with it — a failure
            // to log is logged itself, loudly, but does not become a 500 for the caller.
            log.error("[nlq-audit] Failed to write nlq_query_log row for tenant={} user={}",
                    ctx.tenantId(), ctx.userId(), ex);
        }
    }
}
