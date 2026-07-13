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

    @Query("SELECT o FROM Order o WHERE o.clientOrderId = :clientOrderId")
    Optional<Order> findByClientOrderId(@Param("clientOrderId") UUID clientOrderId);

    @Query("SELECT o FROM Order o WHERE o.branchId = :branchId AND o.status IN :statuses ORDER BY o.createdAt DESC")
    Page<Order> findByBranchIdAndStatusIn(
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
