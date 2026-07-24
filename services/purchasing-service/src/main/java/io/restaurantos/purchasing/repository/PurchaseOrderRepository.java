package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PurchaseOrderRepository extends JpaRepository<PurchaseOrder, UUID> {

    /**
     * Tenant-scoped single-PO lookup (08.2 code-review WR-04). Every lifecycle method routes through
     * this instead of the inherited {@code findById}, so a PO id from another tenant resolves empty
     * rather than relying on the Hibernate tenant filter / RLS alone — matching the
     * {@code StockTransferRepository.findByIdAndTenantId} and {@code IngredientRepository.findByTenantIdAndId}
     * precedent introduced to eliminate exactly this defect class.
     */
    Optional<PurchaseOrder> findByIdAndTenantId(UUID id, UUID tenantId);

    List<PurchaseOrder> findByBranchIdAndStatusIn(UUID branchId, List<PoStatus> statuses);

    List<PurchaseOrder> findByTenantIdAndVendorIdAndBranchId(UUID tenantId, UUID vendorId, UUID branchId);

    long countByBranchIdAndStatus(UUID branchId, PoStatus status);

    /** PUR list endpoint (10-10): branch listing, newest first, no status filter. */
    List<PurchaseOrder> findByTenantIdAndBranchIdOrderByCreatedAtDesc(UUID tenantId, UUID branchId);

    /** PUR list endpoint (10-10): branch listing narrowed by status. */
    List<PurchaseOrder> findByTenantIdAndBranchIdAndStatusInOrderByCreatedAtDesc(
            UUID tenantId, UUID branchId, List<PoStatus> statuses);
}
