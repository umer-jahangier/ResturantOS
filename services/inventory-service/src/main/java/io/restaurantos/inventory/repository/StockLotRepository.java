package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockLot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collection;
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

    /** D-06 measure-type lock (08.2-09): true once any lot has ever been received for this
     * ingredient — a receipt's first lot locks the type even before a depletion movement exists. */
    boolean existsByTenantIdAndIngredientId(UUID tenantId, UUID ingredientId);

    /** Bulk variant of {@link #existsByTenantIdAndIngredientId} for list rendering — one query
     * for the whole page's measure-type-lock flags, never one exists-check per row. */
    @Query("SELECT DISTINCT l.ingredientId FROM StockLot l "
            + "WHERE l.tenantId = :tenantId AND l.ingredientId IN :ingredientIds")
    List<UUID> findDistinctIngredientIdsByTenantIdAndIngredientIdIn(
            @Param("tenantId") UUID tenantId, @Param("ingredientIds") Collection<UUID> ingredientIds);
}
