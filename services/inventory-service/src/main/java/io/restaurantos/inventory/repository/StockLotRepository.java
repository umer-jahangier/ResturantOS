package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockLot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
public interface StockLotRepository extends JpaRepository<StockLot, UUID> {

    /**
     * FEFO walk order for a stock row's lots. PostgreSQL's default null-ordering for
     * {@code ORDER BY ... ASC} is NULLS LAST, so non-perishable (null-expiry) lots naturally
     * sort after every dated lot without an explicit NULLS LAST clause.
     */
    List<StockLot> findByStockIdOrderByExpiryDateAsc(UUID stockId);

    /**
     * Used by the nightly expiry sweep's per-tenant loop ({@code ExpirySweepService.sweepTenant}):
     * lots expiring on/before a date with qty left, scoped to one tenant at a time under an
     * already-active {@code TenantContext}/RLS GUC.
     */
    List<StockLot> findByTenantIdAndExpiryDateLessThanEqualAndQtyGreaterThan(
            UUID tenantId, LocalDate expiryDate, BigDecimal qty);
}
