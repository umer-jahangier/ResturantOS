package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockTransfer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface StockTransferRepository extends JpaRepository<StockTransfer, UUID> {

    /** Tenant-scoped lookup (belt-and-suspenders alongside FORCE RLS) for the receive() flow. */
    @Query("SELECT t FROM StockTransfer t WHERE t.id = :id AND t.tenantId = :tenantId")
    Optional<StockTransfer> findByIdAndTenantId(@Param("id") UUID id, @Param("tenantId") UUID tenantId);

    List<StockTransfer> findByStatus(String status);

    /**
     * 08.2-17: transfers SHIPPED to a branch, awaiting receive — backs the stock screen's
     * Transfer-receive list (UI-SPEC Screen 7). Tenant-scoped (belt-and-suspenders alongside
     * FORCE RLS), ordered oldest-first so the longest-in-transit transfer surfaces first.
     */
    List<StockTransfer> findByTenantIdAndToBranchIdAndStatusOrderByShippedAtAsc(
            UUID tenantId, UUID toBranchId, String status);
}
