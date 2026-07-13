package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface VendorInvoiceRepository extends JpaRepository<VendorInvoice, UUID> {

    List<VendorInvoice> findByTenantIdAndBranchIdOrderByInvoiceDateDesc(UUID tenantId, UUID branchId);

    /** PUR list endpoint (10-10): branch listing narrowed by status. */
    List<VendorInvoice> findByTenantIdAndBranchIdAndStatusInOrderByInvoiceDateDesc(
            UUID tenantId, UUID branchId, Collection<InvoiceStatus> statuses);

    /** PUR-06: invoices eligible for spend analytics (MATCHED/PAID) within a date window, lines fetched eagerly. */
    @Query("""
            SELECT DISTINCT i FROM VendorInvoice i
            LEFT JOIN FETCH i.lines
            WHERE i.tenantId = :tenantId
            AND i.branchId = :branchId
            AND i.status IN :statuses
            AND i.invoiceDate BETWEEN :from AND :to
            """)
    List<VendorInvoice> findForSpendReport(@Param("tenantId") UUID tenantId,
                                           @Param("branchId") UUID branchId,
                                           @Param("statuses") Collection<InvoiceStatus> statuses,
                                           @Param("from") LocalDate from,
                                           @Param("to") LocalDate to);

    @Query("""
            SELECT COUNT(i) FROM VendorInvoice i
            WHERE i.status = :status
            AND i.invoiceDate <= :periodEnd
            """)
    long countByStatusAndInvoiceDateBefore(@Param("status") InvoiceStatus status,
                                           @Param("periodEnd") LocalDate periodEnd);

    @Query("""
            SELECT i FROM VendorInvoice i
            WHERE i.branchId = :branchId
            AND i.status = :status
            AND i.createdAt < :cutoff
            """)
    List<VendorInvoice> findStaleMismatched(@Param("branchId") UUID branchId,
                                            @Param("status") InvoiceStatus status,
                                            @Param("cutoff") Instant cutoff);
}
