package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PurchaseOrderLineRepository extends JpaRepository<PurchaseOrderLine, UUID> {

    List<PurchaseOrderLine> findByPurchaseOrderId(UUID purchaseOrderId);
}
