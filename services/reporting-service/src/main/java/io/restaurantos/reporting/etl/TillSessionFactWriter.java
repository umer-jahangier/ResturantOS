package io.restaurantos.reporting.etl;

import io.restaurantos.reporting.event.ReportingEventPayloads.TillClosedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.LocalDate;

/**
 * Writes TILL_CLOSED into {@code till_session_facts} — feeds the dashboard's cash-position tile
 * (12-06). {@code closed_at} is sourced from the envelope's {@code occurredAt} because the real
 * published payload carries no closed-timestamp field (see
 * ReportingEventPayloads.TillClosedPayload).
 */
@Component
public class TillSessionFactWriter {

    private static final String INSERT_SQL = """
            INSERT INTO clickhouse_analytics.till_session_facts
                (tenant_id, branch_id, business_date, till_session_id, cashier_id,
                 expected_cash_paisa, counted_cash_paisa, variance_paisa, closed_at, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    private final JdbcTemplate clickHouseJdbcTemplate;

    public TillSessionFactWriter(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
    }

    public void write(EventEnvelope<TillClosedPayload> env, LocalDate businessDate) {
        TillClosedPayload payload = env.payload();
        clickHouseJdbcTemplate.update(INSERT_SQL,
                env.tenantId(),
                env.branchId(),
                businessDate,
                payload.tillSessionId(),
                payload.cashierId(),
                payload.expectedCashPaisa(),
                payload.countedCashPaisa(),
                payload.variancePaisa(),
                Timestamp.from(env.occurredAt()),
                env.eventId());
    }
}
