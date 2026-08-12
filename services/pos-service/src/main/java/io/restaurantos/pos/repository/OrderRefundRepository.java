package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.OrderRefund;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OrderRefundRepository extends JpaRepository<OrderRefund, UUID> {

    List<OrderRefund> findByOrderId(UUID orderId);

    /**
     * Total already given back on this order (S0-01). The refund cap is
     * {@code sumAmountByOrderId(payments) - this}, so two half refunds can never together
     * exceed what was taken — the invariant a per-call {@code <= totalPaisa} check misses.
     */
    @Query("SELECT COALESCE(SUM(r.refundPaisa), 0) FROM OrderRefund r WHERE r.orderId = :orderId")
    long sumRefundedByOrderId(@Param("orderId") UUID orderId);

    /**
     * Per-order refunded totals for a whole till in ONE query (S0-01) — the till's expected
     * closing cash subtracts CASH refunds, and doing that per order would be an N+1 across
     * every order in the session.
     */
    @Query("SELECT r FROM OrderRefund r WHERE r.orderId IN :orderIds")
    List<OrderRefund> findByOrderIdIn(@Param("orderIds") List<UUID> orderIds);
}
