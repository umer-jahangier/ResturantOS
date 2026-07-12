package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.Order;
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
