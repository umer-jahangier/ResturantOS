package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.Order;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface OrderRepository extends JpaRepository<Order, UUID> {

    @Query("SELECT o FROM Order o WHERE o.id = :id AND o.branchId = :branchId")
    Optional<Order> findByIdAndBranchId(@Param("id") UUID id, @Param("branchId") UUID branchId);

    /**
     * Idempotency lookup for order creation, scoped to the tenant.
     *
     * <p>The tenant predicate is deliberately in the query as well as being enforced by RLS.
     * {@code clientOrderId} is supplied by the caller, so without it this lookup was a
     * cross-tenant oracle: posting another tenant's clientOrderId returned that tenant's
     * order — items, totals and all — as a "replayed" 200, and bound the caller to it.
     * pos_db's tables are now FORCE ROW LEVEL SECURITY (V11), which closes this at the
     * database; this predicate is the second line of defence, because this lookup ran for
     * a long time with neither.
     */
    @Query("SELECT o FROM Order o WHERE o.tenantId = :tenantId AND o.clientOrderId = :clientOrderId")
    Optional<Order> findByTenantIdAndClientOrderId(
            @Param("tenantId") UUID tenantId,
            @Param("clientOrderId") UUID clientOrderId);

    @Query("SELECT o FROM Order o WHERE o.branchId = :branchId AND o.status IN :statuses ORDER BY o.createdAt DESC")
    Page<Order> findByBranchIdAndStatusIn(
            @Param("branchId") UUID branchId,
            @Param("statuses") Collection<OrderStatus> statuses,
            Pageable pageable);

    /**
     * Explicitly tenant-scoped listing. pos_db's tables are ENABLE (not FORCE) ROW LEVEL SECURITY
     * and the application owns them, so RLS is inert on this connection — the tenant predicate has
     * to be in the query itself rather than relied on from the database or the ambient Hibernate
     * filter, which is not applied on non-web call paths.
     */
    @Query("SELECT o FROM Order o WHERE o.tenantId = :tenantId AND o.branchId = :branchId "
            + "AND o.status IN :statuses ORDER BY o.createdAt DESC")
    Page<Order> findByTenantIdAndBranchIdAndStatusIn(
            @Param("tenantId") UUID tenantId,
            @Param("branchId") UUID branchId,
            @Param("statuses") Collection<OrderStatus> statuses,
            Pageable pageable);

    /**
     * Same as {@link #findByBranchIdAndStatusIn} but additionally scoped to a single
     * creator (POS-09 own-vs-all-branch visibility — a caller without the all-branch
     * permission is silently scoped to their own orders, never a client-supplied filter).
     */
    @Query("SELECT o FROM Order o WHERE o.branchId = :branchId AND o.status IN :statuses "
            + "AND o.cashierId = :cashierId ORDER BY o.createdAt DESC")
    Page<Order> findByBranchIdAndStatusInAndCashierId(
            @Param("branchId") UUID branchId,
            @Param("statuses") Collection<OrderStatus> statuses,
            @Param("cashierId") UUID cashierId,
            Pageable pageable);

    /**
     * S0-05 — server-side Order Management search.
     *
     * <p>Until this existed, the search box was a {@code source.filter(...)} over the rows the
     * page had already fetched, so it could only ever find an order that was both on the current
     * page AND in the currently-selected status scope. Typing the number of a check you had just
     * voided returned "No active orders" — the row was never in the array being filtered.
     *
     * <p>Matching is deliberately three-way and OR'd:
     * <ul>
     *   <li><b>order number</b> — substring, case-insensitive, so {@code 0026} finds
     *       {@code ORD-20260812-0026} (nobody types the prefix);</li>
     *   <li><b>table</b> — by id, because table NAMES live in {@code dining_tables} and joining
     *       them here would make this query branch-shaped; the caller already loads the branch's
     *       table-name map to build each row and resolves the matching ids from it;</li>
     *   <li><b>customer</b> — by id, resolved by the caller from crm-service, which owns phones
     *       and names. pos-service holds no copy of the customer book.</li>
     * </ul>
     *
     * <p>{@code tableIds}/{@code customerIds} must never be empty — an empty JPQL {@code IN} is
     * not portable. The caller substitutes a sentinel UUID that matches nothing.
     *
     * <p>Tenant is a predicate here, not an assumption: pos_db is owned by the application role,
     * so RLS is inert on this connection (see {@link #findByTenantIdAndBranchIdAndStatusIn}).
     */
    @Query("""
            SELECT o FROM Order o
             WHERE o.tenantId = :tenantId
               AND o.branchId = :branchId
               AND o.status IN :statuses
               AND (UPPER(o.orderNo) LIKE UPPER(CONCAT('%', :q, '%'))
                    OR o.tableId IN :tableIds
                    OR o.customerId IN :customerIds)
             ORDER BY o.createdAt DESC
            """)
    Page<Order> searchByTenantAndBranch(
            @Param("tenantId") UUID tenantId,
            @Param("branchId") UUID branchId,
            @Param("statuses") Collection<OrderStatus> statuses,
            @Param("q") String q,
            @Param("tableIds") Collection<UUID> tableIds,
            @Param("customerIds") Collection<UUID> customerIds,
            Pageable pageable);

    /**
     * {@link #searchByTenantAndBranch} additionally scoped to one creator — the same
     * own-vs-all-branch rule the unsearched listing already applies (POS-09). Search must not
     * become the hole through which a cashier without {@code pos.order.view.all} reads a
     * colleague's checks.
     */
    @Query("""
            SELECT o FROM Order o
             WHERE o.tenantId = :tenantId
               AND o.branchId = :branchId
               AND o.status IN :statuses
               AND o.cashierId = :cashierId
               AND (UPPER(o.orderNo) LIKE UPPER(CONCAT('%', :q, '%'))
                    OR o.tableId IN :tableIds
                    OR o.customerId IN :customerIds)
             ORDER BY o.createdAt DESC
            """)
    Page<Order> searchByTenantAndBranchAndCashierId(
            @Param("tenantId") UUID tenantId,
            @Param("branchId") UUID branchId,
            @Param("statuses") Collection<OrderStatus> statuses,
            @Param("q") String q,
            @Param("tableIds") Collection<UUID> tableIds,
            @Param("customerIds") Collection<UUID> customerIds,
            @Param("cashierId") UUID cashierId,
            Pageable pageable);

    /**
     * The current (most-recent) non-terminal order bound to a table (POS-10). "Non-terminal"
     * = not in the caller-supplied {@code excludedStatuses} set (CLOSED/VOIDED/REFUNDED at the
     * call site). Ordered newest-first and {@link Limit}-capped so this READ path never throws
     * {@code IncorrectResultSizeDataAccessException} when a table has more than one active order
     * (e.g. legacy/orphaned rows). "At most one active order per table" is enforced at WRITE time
     * (order create / table assignment), not by making this read fragile — a table lookup must
     * never 500 the floor view.
     */
    @Query("SELECT o FROM Order o WHERE o.tableId = :tableId AND o.status NOT IN :excludedStatuses "
            + "ORDER BY o.createdAt DESC")
    List<Order> findActiveByTableId(
            @Param("tableId") UUID tableId,
            @Param("excludedStatuses") Collection<OrderStatus> excludedStatuses,
            Limit limit);

    @Query("SELECT o FROM Order o WHERE o.tillSessionId = :tillSessionId")
    List<Order> findByTillSessionId(@Param("tillSessionId") UUID tillSessionId);

    /**
     * Count non-terminal orders whose business date (openedAt minus 4 hours, date portion)
     * falls within [periodStart, periodEnd] inclusive, for the current tenant via RLS.
     * Business date uses AT TIME ZONE 'UTC' to match Java's Instant semantics.
     */
    @Query(value = """
            SELECT COUNT(*) FROM orders
            WHERE status IN ('OPEN','SENT_TO_KDS','PARTIAL_READY','READY','SERVED')
              AND CAST((opened_at AT TIME ZONE 'UTC' - INTERVAL '4 hours') AS DATE) >= :periodStart
              AND CAST((opened_at AT TIME ZONE 'UTC' - INTERVAL '4 hours') AS DATE) <= :periodEnd
            """, nativeQuery = true)
    long countOpenOrdersByBusinessDateRange(
            @Param("periodStart") LocalDate periodStart,
            @Param("periodEnd") LocalDate periodEnd);
}
