package io.restaurantos.shared.time;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * The business day an event belongs to.
 *
 * <p>A restaurant's trading day does not end at midnight — an order taken at 01:30 belongs to the
 * previous night's service. The offset (default 4 hours) shifts the boundary into the small hours.
 *
 * <p><b>Why this is shared.</b> Three services each had their own answer for "when did this
 * happen": pos-service checked the accounting period against {@code openedAt − 4h},
 * finance-service dated the journal entry from {@code envelope.occurredAt()} (stamped at publish
 * time), and reporting-service bucketed on {@code closedAt} in the branch's timezone. An order
 * opened 23:00 and closed 00:30 was therefore period-checked against yesterday, posted to today,
 * and reported on yesterday — so ClickHouse sales could not tie to the general ledger across any
 * month boundary. {@code closedAt} is now the single input, and the resolved date travels on the
 * event rather than being re-derived by each consumer.
 */
public final class BusinessDay {

    public static final int DEFAULT_OFFSET_HOURS = 4;

    private BusinessDay() {}

    /** UTC-based, for services that do not hold branch timezone data (pos-service). */
    public static LocalDate of(Instant at) {
        return of(at, ZoneOffset.UTC, DEFAULT_OFFSET_HOURS);
    }

    public static LocalDate of(Instant at, ZoneId zone) {
        return of(at, zone, DEFAULT_OFFSET_HOURS);
    }

    /** Pure and stateless — the offset is explicit for table-driven testing. */
    public static LocalDate of(Instant at, ZoneId zone, int offsetHours) {
        return at.atZone(zone).minusHours(offsetHours).toLocalDate();
    }
}
