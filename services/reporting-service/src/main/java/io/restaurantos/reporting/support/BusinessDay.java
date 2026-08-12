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
 *
 * <p>The arithmetic itself is NOT repeated here: it delegates to
 * {@link io.restaurantos.shared.time.BusinessDay}, the one implementation the whole fleet shares.
 * This class is the Spring-injectable, property-configured face of it — reporting needs a bean it
 * can wire and an offset an operator can turn, pos-service needs the same rule from a plain static.
 * Two copies of one date formula is precisely how the trading day came to be cut three different
 * ways; the copy that lived here was correct and the copies elsewhere were not, and nothing in
 * either file said which was which.
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
        return io.restaurantos.shared.time.BusinessDay.of(occurredAt, branchZone, offsetHours);
    }
}
