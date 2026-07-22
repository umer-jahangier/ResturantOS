package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface IngredientBranchStockRepository extends JpaRepository<IngredientBranchStock, UUID> {

    /**
     * Pessimistic-write row lock for the depletion/receipt/opening-balance read-modify-write
     * flow — mirrors {@code OrderSequenceRepository.findForUpdate}'s exact shape.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM IngredientBranchStock s WHERE s.tenantId = :tenantId "
            + "AND s.branchId = :branchId AND s.ingredientId = :ingredientId")
    Optional<IngredientBranchStock> findForUpdate(
            @Param("tenantId") UUID tenantId,
            @Param("branchId") UUID branchId,
            @Param("ingredientId") UUID ingredientId);

    Optional<IngredientBranchStock> findByBranchIdAndIngredientId(UUID branchId, UUID ingredientId);

    /**
     * Read model for {@code GET /api/v1/inventory/stock} (INV-15). Carries an explicit
     * {@code tenantId} predicate rather than relying on FORCE-RLS + the Hibernate tenant filter
     * alone — the same defect CONTEXT.md flags on
     * {@code RecipeRepository.findByMenuItemIdOrderByVersionDesc}.
     */
    List<IngredientBranchStock> findByTenantIdAndBranchIdOrderByIngredientIdAsc(UUID tenantId, UUID branchId);

    /**
     * Batch read of every ingredient's per-branch moving-average cost for
     * {@code RecipeCostPreviewService} — one query for the whole draft line array rather than one
     * per line (T-08.2-074). Carries the same explicit {@code tenantId} predicate as
     * {@link #findByTenantIdAndBranchIdOrderByIngredientIdAsc} rather than relying on FORCE-RLS +
     * the Hibernate tenant filter alone.
     */
    List<IngredientBranchStock> findByTenantIdAndBranchIdAndIngredientIdIn(
            UUID tenantId, UUID branchId, Collection<UUID> ingredientIds);
}
