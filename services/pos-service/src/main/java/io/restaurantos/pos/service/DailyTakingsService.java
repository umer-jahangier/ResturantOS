package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.DailyTakingsDto;
import io.restaurantos.pos.dto.DailyTakingsDto.TenderLine;
import io.restaurantos.pos.dto.DailyTakingsDto.TillReconciliation;
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
 * <p>{@code (closed_at − 4h)} in UTC — byte-identical to {@code BusinessDay.of(Instant)} in
 * shared-lib, which is what pos stamps on ORDER_CLOSED and what finance dates the journal entry
 * from. 37-03 is the record of what happens when a consumer re-derives this differently.
 */
@Service
public class DailyTakingsService {

    private final EntityManager em;

    public DailyTakingsService(EntityManager em) {
        this.em = em;
    }

    /** Matches shared-lib BusinessDay.DEFAULT_OFFSET_HOURS. */
    private static final int BUSINESS_DAY_OFFSET_HOURS = 4;

    @Transactional(readOnly = true)
    public DailyTakingsDto forDate(LocalDate businessDate, UUID branchId) {
        List<UnknownFigure> unknowns = new ArrayList<>();

        Object[] header = headerTotals(businessDate, branchId);
        long gross = toLong(header[0]);
        long discounts = toLong(header[1]);
        long tax = toLong(header[2]);
        long service = toLong(header[3]);
        long net = toLong(header[4]);
        int orderCount = (int) toLong(header[5]);

        List<TenderLine> byTender = tenderSplit(businessDate, branchId);
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

        return new DailyTakingsDto(businessDate, branchId, gross, discounts, tax, service, net,
                orderCount, byTender, tills, unknowns);
    }

    /**
     * Gross is {@code subtotal}, NOT {@code subtotal − discount}. The same reasoning finance uses
     * when it credits revenue gross and debits the discount to contra-revenue (4920): netting here
     * makes "what did we give away this month?" unanswerable, because the discount has already
     * vanished into a smaller sales number.
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

    private List<TenderLine> tenderSplit(LocalDate date, UUID branchId) {
        Query q = em.createNativeQuery("""
                SELECT p.method, COALESCE(SUM(p.amount_paisa), 0), COUNT(*)
                  FROM order_payments p
                  JOIN orders o ON o.id = p.order_id
                 WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND o.voided_at IS NULL
                   AND date((o.closed_at AT TIME ZONE 'UTC') - make_interval(hours => :offset)) = :date
                   AND (CAST(:branchId AS uuid) IS NULL OR o.branch_id = CAST(:branchId AS uuid))
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
            out.add(new TenderLine((String) r[0], toLong(r[1]), (int) toLong(r[2])));
        }
        return out;
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
