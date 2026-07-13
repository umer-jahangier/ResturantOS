package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.PoApprovalRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface PoApprovalRecordRepository extends JpaRepository<PoApprovalRecord, UUID> {

    boolean existsByPurchaseOrderIdAndApproverIdAndAction(UUID purchaseOrderId, UUID approverId, String action);
}
