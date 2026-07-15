package io.restaurantos.reporting.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Implements PROJECT.md line 68's business-day boundary formula exactly:
 * {@code business_date = DATE(occurredAt AT TIME ZONE branch.timezone - INTERVAL '4 hours')}.
 *
 * A 01:00 order is attributed to the PREVIOUS calendar day — restaurants run late, and a sale at
 * 01:00 belongs to "last night's" business day, not the fresh one that started at midnight. The
 * offset is configurable via {@code restaurantos.business-day.offset-hours}
 * ({@code BUSINESS_DAY_OFFSET_HOURS}, default 4, scoped to pos/finance/reporting in
 * Docs/agent-specs/05-environment-variables.md:47) — never hardcoded.
 */
@Component
public class BusinessDay {

    private final int defaultOffsetHours;

    public BusinessDay(@Value("${restaurantos.business-day.offset-hours:4}") int defaultOffsetHours) {
        this.defaultOffsetHours = defaultOffsetHours;
    }

    /** Uses the configured default offset. */
    public LocalDate businessDate(Instant occurredAt, ZoneId branchZone) {
        return businessDate(occurredAt, branchZone, defaultOffsetHours);
    }

    /** Pure, stateless overload — takes the offset explicitly for table-driven unit testing. */
    public LocalDate businessDate(Instant occurredAt, ZoneId branchZone, int offsetHours) {
        return occurredAt.atZone(branchZone).minusHours(offsetHours).toLocalDate();
    }
}
