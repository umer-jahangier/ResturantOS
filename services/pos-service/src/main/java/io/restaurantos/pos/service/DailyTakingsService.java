package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.DailyTakingsDto;
import io.restaurantos.pos.dto.DailyTakingsDto.TenderLine;
import io.restaurantos.pos.dto.DailyTakingsDto.TillReconciliation;
import io.restaurantos.pos.dto.DailyTakingsDto.UnclosedTakings;
import io.restaurantos.pos.dto.DailyTakingsDto.UnknownFigure;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigInteger;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Daily takings, reconciled against what each till counted (37-09, D-37-02).
 *
 * <h2>Why this lives in pos-service and not reporting-service</h2>
 *
 * <p>The 37-09 plan places this in reporting-service over ClickHouse payment facts built by 37-06.
 * It is built here instead, deliberately, for one reason that outweighs plan fidelity: <b>till
 * counts do not exist in ClickHouse.</b> {@code till_sessions.declared_closing_paisa} — the number
 * a human actually counted in the drawer — lives only in pos_db. A takings screen assembled in
 * reporting could show the takings and could not show whether the drawer matched, which is the one
 * question D-37-02 exists to answer.
 *
 * <p>Building it against pos_db also means the figures are read from the system of record rather
 * than from an ETL projection of it, so a broken consumer cannot make the evening cash-up quietly
 * wrong. 37-06's payment facts remain worth building for historical trend reporting; they are the
 * wrong source for tonight's cash-up.
 *
 * <h2>The business day</h2>
 *
 * <p>{@code (t − 4h)} in UTC — byte-identical to {@code BusinessDay.of(Instant)} in shared-lib,
 * which is what pos stamps on ORDER_CLOSED and what finance dates the journal entry from. 37-03 is
 * the record of what happens when a consumer re-derives this differently.
 *
 * <h2>Which {@code t} — and the S0-02 defect</h2>
 *
 * <p>Sales are dated by {@code orders.closed_at}. <b>Money is dated by
 * {@code order_payments.recorded_at}</b>, and it did not used to be: every query here keyed off
 * {@code closed_at}, so a payment against an order that was paid but not yet served — which POS-23
 * makes the NORMAL case, not an edge case, because an order closes only when it is paid AND served
 * — had a null {@code closed_at} and was excluded from the header totals and the tender split at
 * once. Cash physically in the drawer appeared in neither gross, nor net, nor the CASH line. The
 * till already knew about it: {@code TillServiceImpl.closeTill} sums CASH payments on a till's
 * orders regardless of close, so the expected drawer and this screen disagreed by exactly the
 * unclosed takings, and the screen was the one that was wrong.
 *
 * <p>Merely dropping the {@code closed_at IS NOT NULL} filter would have been worse than the bug:
 * an order opened on Monday and closed on Tuesday would then land in BOTH days. The date basis is
 * changed rather than the filter dropped, and each payment is dated exactly once — by the moment it
 * was taken, which is also the moment it entered a drawer somebody has to count.
 */
@Service
public class DailyTakingsService {

    private final EntityManager em;

    public DailyTakingsService(EntityManager em) {
        this.em = em;
    }

    /** Matches shared-lib BusinessDay.DEFAULT_OFFSET_HOURS. */
    private static final int BUSINESS_DAY_OFFSET_HOURS = 4;

    /**
     * Every payment-basis query below shares this predicate, so the tender split and the unclosed
     * summary can never come to disagree about which payments belong to the day.
     *
     * <p>{@code recorded_at} is nullable on the table (only {@code PaymentServiceImpl} guarantees
     * it), so it falls back to {@code created_at}, which is {@code NOT NULL DEFAULT now()}. Dating
     * a payment by its order's {@code closed_at} is exactly the bug; there is no fallback to it.
     */
    private static final String PAYMENTS_ON_DAY = """
              FROM order_payments p
              JOIN orders o ON o.id = p.order_id
             WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND o.voided_at IS NULL
               AND date((COALESCE(p.recorded_at, p.created_at) AT TIME ZONE 'UTC')
                        - make_interval(hours => :offset)) = :date
               AND (CAST(:branchId AS uuid) IS NULL OR o.branch_id = CAST(:branchId AS uuid))
            """;

    /**
     * The trading day a restaurant is in RIGHT NOW.
     *
     * <p>Not {@code LocalDate.now()}: at 02:00 the restaurant is still working last night's day,
     * and a cash-up screen that defaults to the calendar date shows an empty day to the person
     * holding the drawer. The controller and the screen both take their default from here so the
     * default can only ever be the same rule the queries use.
     */
    public static LocalDate currentBusinessDate() {
        return businessDateOf(Instant.now());
    }

    /** The clock is a parameter so the rule can be asserted at 02:00 without waiting until 02:00. */
    public static LocalDate businessDateOf(Instant t) {
        return LocalDate.ofInstant(
                t.minusSeconds(BUSINESS_DAY_OFFSET_HOURS * 3600L), java.time.ZoneOffset.UTC);
    }

    @Transactional(readOnly = true)
    public DailyTakingsDto forDate(LocalDate businessDate, UUID branchId) {
        List<UnknownFigure> unknowns = new ArrayList<>();

        Object[] header = headerTotals(businessDate, branchId);
        long gross = toLong(header[0]);
        long discounts = toLong(header[1]);
        long tax = toLong(header[2]);
        long service = toLong(header[3]);
        long totalBilled = toLong(header[4]);
        int orderCount = (int) toLong(header[5]);

        // Net sales is gross LESS discounts, with tax and service charge OUTSIDE it — the P&L
        // definition, and the only one under which the word "net" is not a lie. Stated here, by
        // the server, from the two figures the screen shows immediately above it, so the tile can
        // never disagree with the tiles it is derived from and the browser can go on doing no
        // arithmetic at all (T-32-12-E).
        //
        // Exact, not approximately exact: both operands are BIGINT paisa summed by the database,
        // and SUM(a) − SUM(b) over a NOT NULL pair is identical to SUM(a − b). No rounding exists
        // on this path and none may be introduced — a rate never touches these numbers.
        long net = gross - discounts;

        List<TenderLine> byTender = tenderSplit(businessDate, branchId);
        UnclosedTakings unclosed = unclosedTakings(businessDate, branchId);
        List<TillReconciliation> tills = tillReconciliations(businessDate, branchId);

        // D-37-05, stated rather than papered over. Comps are not separable from discounts in this
        // schema: `orders.discount_paisa` is a single column and a 100% comp is recorded as a
        // discount equal to the subtotal. Reporting a comp figure would mean inventing a split the
        // data does not carry.
        unknowns.add(new UnknownFigure("comps",
                "Comps are not recorded separately from discounts. orders.discount_paisa is one "
                        + "column, and a full comp appears in it as a discount equal to the "
                        + "subtotal. Splitting them would require a field POS does not capture."));

        long cashTaken = byTender.stream()
                .filter(t -> "CASH".equalsIgnoreCase(t.method()))
                .mapToLong(TenderLine::amountPaisa).sum();
        boolean anyCountedTill = tills.stream().anyMatch(t -> t.declaredClosingPaisa() != null);
        if (cashTaken > 0 && !anyCountedTill) {
            // The variance genuinely cannot be computed. Say so; do NOT report a zero variance,
            // which reads as "the drawer matched" — the single most dangerous fabricated figure
            // this screen could produce.
            unknowns.add(new UnknownFigure("cash variance",
                    "Cash was taken on this day but no till was closed and counted, so there is "
                            + "nothing to compare the expected drawer against. This is NOT a zero "
                            + "variance."));
        }

        return new DailyTakingsDto(businessDate, branchId, gross, discounts, net, tax, service,
                totalBilled, orderCount, byTender, tills, unclosed, unknowns);
    }

    /**
     * Gross is {@code subtotal}, NOT {@code subtotal − discount}. The same reasoning finance uses
     * when it credits revenue gross and debits the discount to contra-revenue (4920): netting here
     * makes "what did we give away this month?" unanswerable, because the discount has already
     * vanished into a smaller sales number.
     *
     * <p>The fifth column is {@code SUM(total_paisa)} — the TOTAL BILLED, tax and service charge
     * included. It is not net sales and must never again be handed to a field called net: net
     * sales is derived in {@link #forDate} as {@code gross − discounts}, which is the only reading
     * under which a figure named "net" can be smaller than the gross it came from.
     *
     * <p>These figures stay on {@code closed_at} and MUST. They are the sales the general ledger
     * recognised on this day, and finance dates its revenue journal entry from the ORDER_CLOSED
     * event; moving them onto payment time would make the takings screen and the ledger disagree,
     * and would double-count any order settled across two trading days. The money taken against
     * orders that have not reached here yet is reported separately and explicitly — see
     * {@code unclosedTakings}.
     */
    private Object[] headerTotals(LocalDate date, UUID branchId) {
        Query q = em.createNativeQuery("""
                SELECT COALESCE(SUM(o.subtotal_paisa), 0),
                       COALESCE(SUM(o.discount_paisa), 0),
                       COALESCE(SUM(o.tax_paisa), 0),
                       COALESCE(SUM(o.service_charge_paisa), 0),
                       COALESCE(SUM(o.total_paisa), 0),
                       COUNT(*)
                  FROM orders o
                 WHERE o.deleted_at IS NULL
                   AND o.closed_at IS NOT NULL
                   AND o.voided_at IS NULL
                   AND date((o.closed_at AT TIME ZONE 'UTC') - make_interval(hours => :offset)) = :date
                   AND (CAST(:branchId AS uuid) IS NULL OR o.branch_id = CAST(:branchId AS uuid))
                """);
        q.setParameter("offset", BUSINESS_DAY_OFFSET_HOURS);
        q.setParameter("date", date);
        q.setParameter("branchId", branchId == null ? null : branchId.toString());
        return (Object[]) q.getSingleResult();
    }

    /**
     * How the money arrived, dated by WHEN IT ARRIVED.
     *
     * <p>Every line also carries the part of itself that is sitting against an order which has not
     * closed. That is reported as a SUBSET of the line, never as a separate line: two rows would
     * invite a reader to add them, and the sum would be twice the cash that exists.
     */
    private List<TenderLine> tenderSplit(LocalDate date, UUID branchId) {
        Query q = em.createNativeQuery("""
                SELECT p.method,
                       COALESCE(SUM(p.amount_paisa), 0),
                       COUNT(*),
                       COALESCE(SUM(p.amount_paisa) FILTER (WHERE o.closed_at IS NULL), 0),
                       COUNT(*) FILTER (WHERE o.closed_at IS NULL)
                """ + PAYMENTS_ON_DAY + """
                 GROUP BY p.method
                 ORDER BY p.method
                """);
        q.setParameter("offset", BUSINESS_DAY_OFFSET_HOURS);
        q.setParameter("date", date);
        q.setParameter("branchId", branchId == null ? null : branchId.toString());
        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();
        List<TenderLine> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(new TenderLine((String) r[0], toLong(r[1]), (int) toLong(r[2]),
                    toLong(r[3]), (int) toLong(r[4])));
        }
        return out;
    }

    /**
     * The money taken today that has not become a closed sale yet — the reconciliation bridge
     * between the drawer (which holds it) and gross/net (which will not report it until the order
     * closes, possibly on another trading day).
     *
     * <p>Runs over {@link #PAYMENTS_ON_DAY}, the same predicate {@link #tenderSplit} uses, so the
     * summary and the per-line subsets are answers to one question rather than two.
     */
    private UnclosedTakings unclosedTakings(LocalDate date, UUID branchId) {
        Query q = em.createNativeQuery("""
                SELECT COALESCE(SUM(p.amount_paisa) FILTER (WHERE p.method = 'CASH'), 0),
                       COALESCE(SUM(p.amount_paisa), 0),
                       COUNT(DISTINCT o.id),
                       COUNT(*)
                """ + PAYMENTS_ON_DAY + """
                   AND o.closed_at IS NULL
                """);
        q.setParameter("offset", BUSINESS_DAY_OFFSET_HOURS);
        q.setParameter("date", date);
        q.setParameter("branchId", branchId == null ? null : branchId.toString());
        Object[] r = (Object[]) q.getSingleResult();
        return new UnclosedTakings(toLong(r[0]), toLong(r[1]), (int) toLong(r[2]), (int) toLong(r[3]));
    }

    private List<TillReconciliation> tillReconciliations(LocalDate date, UUID branchId) {
        // A till is attributed to the trading day it was OPENED on: a shift that opens at 18:00 and
        // closes at 02:00 belongs to the evening it started, which is the same convention the
        // business-day offset encodes for sales.
        Query q = em.createNativeQuery("""
                SELECT t.id, t.cashier_id, t.status, t.opening_float_paisa,
                       t.expected_closing_paisa, t.declared_closing_paisa, t.variance_paisa,
                       t.opened_at, t.closed_at
                  FROM till_sessions t
                 WHERE t.deleted_at IS NULL
                   AND date((t.opened_at AT TIME ZONE 'UTC') - make_interval(hours => :offset)) = :date
                   AND (CAST(:branchId AS uuid) IS NULL OR t.branch_id = CAST(:branchId AS uuid))
                 ORDER BY t.opened_at
                """);
        q.setParameter("offset", BUSINESS_DAY_OFFSET_HOURS);
        q.setParameter("date", date);
        q.setParameter("branchId", branchId == null ? null : branchId.toString());
        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();

        List<TillReconciliation> out = new ArrayList<>();
        for (Object[] r : rows) {
            String status = (String) r[2];
            Long expected = toNullableLong(r[4]);
            Long declared = toNullableLong(r[5]);
            Long variance = toNullableLong(r[6]);

            // The state is computed explicitly and named, never left for a renderer to infer from
            // a null — a dash that means "still open" and a dash that means "nobody counted it"
            // are different facts and demand different reactions.
            String state;
            if (!"CLOSED".equalsIgnoreCase(status)) {
                state = "OPEN";
            } else if (declared == null) {
                state = "NOT_COUNTED";
            } else if (variance == null || variance == 0L) {
                state = "MATCHED";
            } else if (variance > 0L) {
                state = "OVER";
            } else {
                state = "SHORT";
            }

            out.add(new TillReconciliation(
                    (UUID) r[0], (UUID) r[1], status, toLong(r[3]),
                    expected, declared, variance,
                    toInstant(r[7]), toInstant(r[8]), state));
        }
        return out;
    }

    private static Instant toInstant(Object o) {
        if (o instanceof Timestamp ts) return ts.toInstant();
        if (o instanceof Instant i) return i;
        if (o instanceof java.time.OffsetDateTime odt) return odt.toInstant();
        return null;
    }

    private static long toLong(Object o) {
        if (o == null) return 0L;
        if (o instanceof BigInteger bi) return bi.longValue();
        if (o instanceof Number n) return n.longValue();
        return 0L;
    }

    private static Long toNullableLong(Object o) {
        if (o == null) return null;
        if (o instanceof BigInteger bi) return bi.longValue();
        if (o instanceof Number n) return n.longValue();
        return null;
    }
}
