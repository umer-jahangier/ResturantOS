package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
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

    /**
     * Goods received on or before {@code periodEndInstant} whose purchase order still has no
     * MATCHED vendor invoice — i.e. the GR/IR balance that is genuinely unreconciled at period end.
     *
     * <p>This is the real source for finance's period-close pre-check. It previously called
     * inventory-service, which counted {@code inventory_movements} rows carrying a
     * {@code reference_type = 'PENDING_GRN'} sentinel that NOTHING has ever written — the
     * repository's own Javadoc said so, and said Phase 10 would repoint it. Phase 10 shipped real
     * GRNs into purchasing_db and left the seam untouched, so the gate returned 0 unconditionally
     * and a period could be locked with receipts outstanding, which is exactly what it exists to
     * prevent.
     *
     * <p>Counts distinct GRN batches, not lines: one goods receipt is one thing to reconcile.
     */
    @Query("""
            SELECT COUNT(DISTINCT r.grnId) FROM MockGrnReceipt r
             WHERE r.tenantId = :tenantId
               AND r.receivedAt <= :periodEndInstant
               AND NOT EXISTS (
                    SELECT 1 FROM VendorInvoice i
                     WHERE i.purchaseOrderId = r.purchaseOrderId
                       AND i.tenantId = r.tenantId
                       AND i.status = io.restaurantos.purchasing.domain.enums.InvoiceStatus.MATCHED)
            """)
    long countUnreconciledAsOf(@Param("tenantId") UUID tenantId,
                               @Param("periodEndInstant") Instant periodEndInstant);
}
