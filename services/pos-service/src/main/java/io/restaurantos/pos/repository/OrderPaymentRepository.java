package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.OrderPayment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OrderPaymentRepository extends JpaRepository<OrderPayment, UUID> {

    List<OrderPayment> findByOrderId(UUID orderId);

    @Query("SELECT COALESCE(SUM(p.amountPaisa), 0) FROM OrderPayment p WHERE p.orderId = :orderId")
    Long sumAmountByOrderId(@Param("orderId") UUID orderId);

    /**
     * Batched per-order payment sums (POS-24) — used by {@code listOrderSummaries} to derive
     * {@code amountPaidPaisa}/{@code paymentStatus} for an entire page in ONE query instead of
     * one {@link #sumAmountByOrderId} call per row (N+1 avoidance). Orders with zero payments
     * are simply absent from the result — callers must default to 0.
     */
    @Query("SELECT p.orderId AS orderId, COALESCE(SUM(p.amountPaisa), 0) AS totalPaisa "
            + "FROM OrderPayment p WHERE p.orderId IN :orderIds GROUP BY p.orderId")
    List<OrderPaymentSum> sumAmountByOrderIds(@Param("orderIds") List<UUID> orderIds);

    interface OrderPaymentSum {
        UUID getOrderId();
        Long getTotalPaisa();
    }
}
