package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.OrderRefund;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OrderRefundRepository extends JpaRepository<OrderRefund, UUID> {

    List<OrderRefund> findByOrderId(UUID orderId);
}
