package io.restaurantos.pos.support;

import io.restaurantos.shared.time.BusinessDay;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

/**
 * "Which trading day is this?", asked once, answered once, for pos-service.
 *
 * <p>Before this class there were THREE answers inside this one service and none of them agreed:
 *
 * <ul>
 *   <li>{@code OrderServiceImpl.performClose} used {@code BusinessDay.of(closedAt)} — UTC minus
 *       4h — for the accounting-period check AND for the {@code businessDate} stamped on
 *       ORDER_CLOSED, which finance copies verbatim onto the journal entry's {@code entry_date};</li>
 *   <li>{@code DailyTakingsService} re-implemented the same UTC rule in five separate SQL
 *       predicates, plus a {@code currentBusinessDate()} that supplies the cash-up screen's
 *       default date;</li>
 *   <li>{@code OrderServiceImpl.generateOrderNo} used a bare {@code LocalDate.now()} — no zone, no
 *       offset, and evaluated three separate times in one method — for the date on the face of
 *       {@code ORD-YYYYMMDD-NNNN}.</li>
 * </ul>
 *
 * <p>For a branch on {@code Asia/Karachi} the first two cut the day at 09:00 local instead of
 * 04:00, so every sale between those hours — the whole of breakfast — was filed to yesterday on
 * the Takings screen and in the ledger while the payment list, the till session and the order
 * number all said today. The third depended on the JVM's default zone, which is the deployment's
 * business and not the restaurant's.
 *
 * <p>Every date question in pos-service now goes through here, and here delegates the arithmetic
 * to shared-lib's {@link BusinessDay} so pos, finance and reporting are running one formula rather
 * than three copies of one intention.
 *
 * <p>The offset is the same property reporting-service reads
 * ({@code restaurantos.business-day.offset-hours}, {@code BUSINESS_DAY_OFFSET_HOURS}) — a tenant
 * that moves its boundary must move it for both or the drift comes straight back.
 */
@Component
public class BranchBusinessDay {

    private final BranchTimeZoneResolver zones;
    private final int offsetHours;

    public BranchBusinessDay(BranchTimeZoneResolver zones,
                             @Value("${restaurantos.business-day.offset-hours:4}") int offsetHours) {
        this.zones = zones;
        this.offsetHours = offsetHours;
    }

    /** The branch's IANA zone, for callers that must hand it to SQL rather than to Java. */
    public ZoneId zoneOf(UUID branchId) {
        return zones.resolve(branchId);
    }

    public int offsetHours() {
        return offsetHours;
    }

    /** The trading day {@code at} belongs to, on {@code branchId}'s own wall clock. */
    public LocalDate dateOf(Instant at, UUID branchId) {
        return BusinessDay.of(at, zoneOf(branchId), offsetHours);
    }

    /**
     * The trading day the branch is in RIGHT NOW.
     *
     * <p>Not {@code LocalDate.now()}: at 02:00 the restaurant is still working last night's day, and
     * a cash-up screen that defaults to the calendar date shows an empty page to the person holding
     * the drawer. Not the JVM's zone either — the machine running the JVM and the restaurant being
     * cashed up are routinely on different continents.
     */
    public LocalDate currentDate(UUID branchId) {
        return dateOf(Instant.now(), branchId);
    }
}
