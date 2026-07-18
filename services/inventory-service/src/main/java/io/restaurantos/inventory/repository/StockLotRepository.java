package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockLot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
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

    /** Used by the nightly expiry sweep (later plan): lots expiring on/before a date with qty left. */
    List<StockLot> findByTenantIdAndExpiryDateLessThanEqualAndQtyGreaterThan(
            UUID tenantId, LocalDate expiryDate, BigDecimal qty);

    /**
     * The distinct tenant set with at least one candidate lot for the nightly expiry sweep
     * (08-08, INV-06 / D-04). Subject to the SAME FORCE RLS policy as every other query on this
     * table — it only ever sees tenants visible under whatever {@code TenantContext} is active
     * when it runs (see {@code ExpirySweepService.sweep}'s javadoc for the full explanation of this
     * constraint).
     */
    @Query("SELECT DISTINCT l.tenantId FROM StockLot l WHERE l.expiryDate <= :cutoff AND l.qty > 0")
    List<UUID> findDistinctTenantIdsWithExpiringLots(@Param("cutoff") LocalDate cutoff);
}
