package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MockGrnReceiptRepository extends JpaRepository<MockGrnReceipt, UUID> {

    Optional<MockGrnReceipt> findTopByPoLineIdOrderByReceivedAtDesc(UUID poLineId);

    boolean existsByPurchaseOrderId(UUID purchaseOrderId);

    @Query("SELECT COALESCE(SUM(r.receivedQty), 0) FROM MockGrnReceipt r WHERE r.poLineId = :poLineId")
    BigDecimal sumReceivedQtyByPoLineId(@Param("poLineId") UUID poLineId);

    Optional<MockGrnReceipt> findByTenantIdAndIdempotencyKey(UUID tenantId, String idempotencyKey);

    List<MockGrnReceipt> findByPurchaseOrderId(UUID purchaseOrderId);
}
