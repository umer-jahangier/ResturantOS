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
}
