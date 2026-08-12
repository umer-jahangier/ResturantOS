package io.restaurantos.shared.time;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * The business day an event belongs to.
 *
 * <p>A restaurant's trading day does not end at midnight — an order taken at 01:30 belongs to the
 * previous night's service. The offset (default 4 hours) shifts the boundary into the small hours.
 * The boundary is cut <b>on the branch's own wall clock</b>: PROJECT.md line 68 states the rule as
 * {@code DATE(occurredAt AT TIME ZONE branch.timezone - INTERVAL '4 hours')}, and {@code /app/settings}
 * tells the owner, on the timezone field itself, that "Business dates and reports are cut on it".
 *
 * <p><b>Why this is shared.</b> Three services each had their own answer for "when did this
 * happen": pos-service checked the accounting period against {@code openedAt − 4h},
 * finance-service dated the journal entry from {@code envelope.occurredAt()} (stamped at publish
 * time), and reporting-service bucketed on {@code closedAt} in the branch's timezone. An order
 * opened 23:00 and closed 00:30 was therefore period-checked against yesterday, posted to today,
 * and reported on yesterday — so ClickHouse sales could not tie to the general ledger across any
 * month boundary. {@code closedAt} is now the single input, and the resolved date travels on the
 * event rather than being re-derived by each consumer.
 *
 * <p><b>There is deliberately no UTC overload, and there must never be one again.</b> This class
 * used to ship {@code of(Instant)}, documented "for services that do not hold branch timezone
 * data (pos-service)". pos-service used it for the accounting-period check AND for the
 * {@code businessDate} stamped on ORDER_CLOSED, which finance copies verbatim onto the journal
 * entry — so for {@code Asia/Karachi} (UTC+5) the trading day was cut at 09:00 local instead of
 * 04:00 and every sale in the five hours between, the whole of breakfast, was filed to yesterday
 * in the ledger. A convenience overload that silently assumes a zone cannot be reviewed at the
 * call site: the caller looks correct. pos-service now answers "which zone?" with
 * {@code io.restaurantos.pos.support.BranchBusinessDay}, which reads the branch record it already
 * fetches for the receipt header.
 */
public final class BusinessDay {

    public static final int DEFAULT_OFFSET_HOURS = 4;

    private BusinessDay() {}

    /**
     * @deprecated UTC is not any restaurant's trading day. Use {@link #of(Instant, ZoneId)} with the
     *     BRANCH's zone. No PRODUCTION code calls it any more — pos-service was the only caller and
     *     now goes through {@code BranchBusinessDay}. Six test fixtures in reporting-service and
     *     inventory-service still construct payloads with it (they only need A date, not the right
     *     one); rewrite those and delete this, so that a service which cannot say which zone it
     *     means fails to compile rather than answering "UTC" on the owner's behalf.
     */
    @Deprecated(forRemoval = true)
    public static LocalDate of(Instant at) {
        return of(at, java.time.ZoneOffset.UTC, DEFAULT_OFFSET_HOURS);
    }

    public static LocalDate of(Instant at, ZoneId zone) {
        return of(at, zone, DEFAULT_OFFSET_HOURS);
    }

    /** Pure and stateless — the offset is explicit for table-driven testing. */
    public static LocalDate of(Instant at, ZoneId zone, int offsetHours) {
        return at.atZone(zone).minusHours(offsetHours).toLocalDate();
    }
}
