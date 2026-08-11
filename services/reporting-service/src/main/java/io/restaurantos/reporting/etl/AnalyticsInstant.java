package io.restaurantos.reporting.etl;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/**
 * The ONE way this service binds an {@link Instant} into a ClickHouse {@code DateTime64(3,'UTC')}
 * column. Every ETL writer must go through {@link #utc(Instant)}; never bind a
 * {@link java.sql.Timestamp} to one of those columns directly.
 *
 * <h2>Why this class exists (DEFECT-37-03-B)</h2>
 *
 * <p>Passing {@code Timestamp.from(instant)} as a {@code JdbcTemplate} argument stored the JVM's
 * local wall-clock in a column declared UTC. On this deployment (JVM zone {@code Asia/Karachi},
 * UTC+5, no DST) every analytics fact landed <b>exactly five hours in the future</b>, so every
 * time-of-day report over those facts was wrong — including the daily-takings screen, which is a
 * time-of-day report and the first number an owner looks at.
 *
 * <h2>The mechanism, which is NOT the obvious one</h2>
 *
 * <p>The defect was originally recorded as "{@code setTimestamp} called without a {@link
 * java.util.Calendar}". That reading is wrong, and acting on it makes things no better. Measured
 * against a live ClickHouse 25.9 with clickhouse-jdbc 0.8.6, JVM zone Asia/Karachi, binding the
 * instant {@code 2026-07-16T14:30:00.932Z}:
 *
 * <pre>
 *   ps.setTimestamp(i, ts)                     -> 14:30:00.932  CORRECT
 *   ps.setTimestamp(i, ts, utcCalendar)        -> 19:30:00.932  WRONG (+5h)   &lt;- the "obvious fix"
 *   ps.setObject(i, ts)                        -> 19:30:00.932  WRONG (+5h)
 *   ps.setObject(i, LocalDateTime  @UTC)       -> 14:30:00.932  CORRECT
 *   ps.setObject(i, OffsetDateTime @UTC)       -> 14:30:00.932  CORRECT
 *   jdbcTemplate.update(sql, ts)               -> 19:30:00.932  WRONG (+5h)   &lt;- production path
 *   jdbcTemplate.update(sql, OffsetDateTime)   -> 14:30:00.932  CORRECT
 * </pre>
 *
 * <p>Note that adding a UTC {@code Calendar} is <b>also</b> wrong. The driver's {@code setTimestamp}
 * is fine; the problem is that Spring never calls it. {@code StatementCreatorUtils.isDateValue()}
 * explicitly <i>excludes</i> {@code java.sql.Timestamp} from its "date value" test, so a
 * {@code Timestamp} argument falls through to {@code ps.setObject(i, value)} — and this driver's
 * {@code setObject} renders a {@code Timestamp} in the JVM default zone, while the column then
 * reads that wall-clock as UTC.
 *
 * <p>An {@link OffsetDateTime} carries its own offset, so no driver and no JVM default zone can
 * reinterpret it. That is why this method returns one rather than a {@code LocalDateTime}: both
 * measure correct today, but a zoneless value is only accidentally right — it depends on the
 * column staying UTC-typed, and it reads to a human as "some local time".
 */
public final class AnalyticsInstant {

    private AnalyticsInstant() {
    }

    /**
     * Binds an absolute instant for a {@code DateTime64(3,'UTC')} column.
     *
     * @param instant the true instant; {@code null} is passed through so a nullable column can
     *                still be written as NULL
     * @return the same instant carrying an explicit UTC offset, safe to pass to {@code JdbcTemplate}
     */
    public static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
