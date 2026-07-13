package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PurchaseOrderRepository extends JpaRepository<PurchaseOrder, UUID> {

    List<PurchaseOrder> findByBranchIdAndStatusIn(UUID branchId, List<PoStatus> statuses);

    List<PurchaseOrder> findByTenantIdAndVendorIdAndBranchId(UUID tenantId, UUID vendorId, UUID branchId);

    long countByBranchIdAndStatus(UUID branchId, PoStatus status);

    /** PUR list endpoint (10-10): branch listing, newest first, no status filter. */
    List<PurchaseOrder> findByTenantIdAndBranchIdOrderByCreatedAtDesc(UUID tenantId, UUID branchId);

    /** PUR list endpoint (10-10): branch listing narrowed by status. */
    List<PurchaseOrder> findByTenantIdAndBranchIdAndStatusInOrderByCreatedAtDesc(
            UUID tenantId, UUID branchId, List<PoStatus> statuses);
}
