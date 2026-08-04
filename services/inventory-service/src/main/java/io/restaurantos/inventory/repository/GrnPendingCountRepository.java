package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.InventoryMovement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

/**
 * Backs {@code GET /internal/grn/pending-count} — finance's period-close pre-check (07-02-D,
 * 08-RESEARCH.md Assumption A1).
 *
 * <p>Purchasing / PO / GRN 3-way match is out of scope until Phase 10, so
 * {@code inventory_movements} has no real "pending reconciliation" flag yet. This query filters
 * on the {@code PENDING_GRN} sentinel {@code reference_type} that {@code ReceiptService} never
 * writes today (receipts always write {@code reference_type='RECEIPT'}) — it is a genuine,
 * tenant-scoped COUNT query (not a hard-coded {@code 0}), and structurally evaluates to 0 against
 * current production data until Phase 10's purchasing-service repoints this sentinel to a real
 * GRN-reconciliation concept.
 */
@Repository
public interface GrnPendingCountRepository extends JpaRepository<InventoryMovement, UUID> {

    @Query("SELECT COUNT(m) FROM InventoryMovement m WHERE m.tenantId = :tenantId "
            + "AND m.movementType = 'RECEIPT' AND m.referenceType = 'PENDING_GRN' "
            + "AND m.movementAt <= :periodEndInstant")
    long countPendingAsOf(@Param("tenantId") UUID tenantId, @Param("periodEndInstant") Instant periodEndInstant);
}
