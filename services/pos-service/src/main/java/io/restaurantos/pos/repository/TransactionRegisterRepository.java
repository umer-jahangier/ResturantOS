package io.restaurantos.pos.repository;

import io.restaurantos.pos.dto.TransactionFilterRequest;
import io.restaurantos.pos.dto.TransactionRowDto;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;

import java.math.BigInteger;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The transaction register query (37-08, D-37-01) — every money event, in one place, for the first
 * time.
 *
 * <p>Three tables carry money events and have never been queryable together: {@code order_payments}
 * (a tender applied), {@code order_refunds} (money going back) and {@code orders} itself (a void
 * cancelling a bill). This UNIONs them at money-event grain — see {@link TransactionRowDto} for why
 * the grain is an event and not an order.
 *
 * <p><b>Tenant isolation is by RLS, not by this SQL.</b> There is no {@code tenant_id} predicate
 * below and there must not be one: every table here is tenant-policied, the GUC is set per request,
 * and adding an application filter would create a second, weaker answer that could drift from the
 * policy. Branch scoping IS in the SQL, because branch is a filter the caller chooses, not an
 * isolation boundary.
 *
 * <p>Native SQL rather than JPQL because JPQL has no UNION, and three separate round trips with
 * application-side merging would break both paging and the aggregate totals.
 */
@Repository
public class TransactionRegisterRepository {

    private final EntityManager em;

    public TransactionRegisterRepository(EntityManager em) {
        this.em = em;
    }

    /**
     * The event stream, before paging. Kept as one string so the page query and the totals query
     * cannot drift apart — they must filter identically or the footer contradicts the rows.
     */
    private static final String EVENTS_CTE = """
            WITH events AS (
                SELECT 'TENDER'          AS event_kind,
                       p.recorded_at     AS event_at,
                       o.id              AS order_id,
                       o.order_no        AS order_no,
                       o.branch_id       AS branch_id,
                       o.cashier_id      AS cashier_id,
                       o.till_session_id AS till_session_id,
                       p.method          AS tender_method,
                       p.amount_paisa    AS event_amount_paisa,
                       NULL              AS reason,
                       o.status          AS order_status,
                       o.subtotal_paisa, o.discount_paisa, o.tax_paisa,
                       o.service_charge_paisa, o.total_paisa
                  FROM order_payments p
                  JOIN orders o ON o.id = p.order_id
                 WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL

                UNION ALL

                SELECT 'REFUND',
                       r.created_at,
                       o.id, o.order_no, o.branch_id, o.cashier_id, o.till_session_id,
                       NULL,
                       -r.refund_paisa,     -- money going OUT is negative, so a sum is a net
                       r.reason,
                       o.status,
                       o.subtotal_paisa, o.discount_paisa, o.tax_paisa,
                       o.service_charge_paisa, o.total_paisa
                  FROM order_refunds r
                  JOIN orders o ON o.id = r.order_id
                 WHERE r.deleted_at IS NULL AND o.deleted_at IS NULL

                UNION ALL

                SELECT 'VOID',
                       o.voided_at,
                       o.id, o.order_no, o.branch_id, o.cashier_id, o.till_session_id,
                       NULL,
                       -o.total_paisa,
                       o.void_reason,
                       o.status,
                       o.subtotal_paisa, o.discount_paisa, o.tax_paisa,
                       o.service_charge_paisa, o.total_paisa
                  FROM orders o
                 WHERE o.voided_at IS NOT NULL AND o.deleted_at IS NULL
            )
            """;

    private record Filters(String sql, Map<String, Object> params) {}

    private Filters buildFilters(TransactionFilterRequest f) {
        StringBuilder where = new StringBuilder(" WHERE event_at >= :from AND event_at < :to ");
        Map<String, Object> params = new java.util.HashMap<>();
        params.put("from", Timestamp.from(f.from().atStartOfDay(ZoneOffset.UTC).toInstant()));
        // Exclusive upper bound on the day AFTER `to`, so the last day is fully included. A
        // `<= to` on a timestamp column silently drops everything after midnight on the final day.
        params.put("to", Timestamp.from(f.to().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant()));

        if (f.branchId() != null) {
            where.append(" AND branch_id = :branchId ");
            params.put("branchId", f.branchId());
        }
        if (f.cashierId() != null) {
            where.append(" AND cashier_id = :cashierId ");
            params.put("cashierId", f.cashierId());
        }
        if (f.tenderMethod() != null && !f.tenderMethod().isBlank()) {
            // Applies to TENDER rows only. A refund carries no method in this schema, so filtering
            // by tender must not silently drop every refund from a "card" view without saying so —
            // the caller filters event kinds separately if they want that.
            where.append(" AND tender_method = :tenderMethod ");
            params.put("tenderMethod", f.tenderMethod());
        }
        if (f.statuses() != null && !f.statuses().isEmpty()) {
            where.append(" AND order_status IN (:statuses) ");
            params.put("statuses", f.statuses());
        }
        if (f.eventKinds() != null && !f.eventKinds().isEmpty()) {
            where.append(" AND event_kind IN (:eventKinds) ");
            params.put("eventKinds", f.eventKinds().stream().map(Enum::name).toList());
        }
        return new Filters(where.toString(), params);
    }

    public List<TransactionRowDto> findRows(TransactionFilterRequest f) {
        Filters filters = buildFilters(f);
        Query q = em.createNativeQuery(EVENTS_CTE
                + " SELECT event_kind, event_at, order_id, order_no, branch_id, cashier_id,"
                + "        till_session_id, tender_method, event_amount_paisa, reason, order_status,"
                + "        subtotal_paisa, discount_paisa, tax_paisa, service_charge_paisa, total_paisa"
                + "   FROM events " + filters.sql()
                + " ORDER BY event_at DESC, order_no DESC"
                + " LIMIT :limit OFFSET :offset");
        filters.params().forEach(q::setParameter);
        q.setParameter("limit", f.sizeOrDefault());
        q.setParameter("offset", (long) f.pageOrDefault() * f.sizeOrDefault());

        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();
        List<TransactionRowDto> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(new TransactionRowDto(
                    TransactionRowDto.EventKind.valueOf((String) r[0]),
                    toInstant(r[1]),
                    (UUID) r[2],
                    (String) r[3],
                    (UUID) r[4],
                    (UUID) r[5],
                    (UUID) r[6],
                    (String) r[7],
                    toLong(r[8]),
                    (String) r[9],
                    (String) r[10],
                    toLong(r[11]), toLong(r[12]), toLong(r[13]), toLong(r[14]), toLong(r[15])));
        }
        return out;
    }

    /** Aggregates over the WHOLE filtered range — never over the page. */
    public long[] totals(TransactionFilterRequest f) {
        Filters filters = buildFilters(f);
        Query q = em.createNativeQuery(EVENTS_CTE
                + " SELECT COUNT(*),"
                + "        COALESCE(SUM(event_amount_paisa), 0),"
                + "        COALESCE(SUM(CASE WHEN event_kind = 'TENDER' THEN event_amount_paisa ELSE 0 END), 0),"
                + "        COALESCE(SUM(CASE WHEN event_kind = 'REFUND' THEN -event_amount_paisa ELSE 0 END), 0),"
                + "        COALESCE(SUM(CASE WHEN event_kind = 'VOID'   THEN -event_amount_paisa ELSE 0 END), 0)"
                + "   FROM events " + filters.sql());
        filters.params().forEach(q::setParameter);
        Object[] r = (Object[]) q.getSingleResult();
        return new long[]{toLong(r[0]), toLong(r[1]), toLong(r[2]), toLong(r[3]), toLong(r[4])};
    }

    private static Instant toInstant(Object o) {
        if (o == null) return null;
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
}
