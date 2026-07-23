package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.InventoryMovement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface InventoryMovementRepository extends JpaRepository<InventoryMovement, UUID> {

    List<InventoryMovement> findByReferenceId(UUID referenceId);

    /**
     * D-06 measure-type lock (08.2-09): true once any movement has ever been recorded for this
     * ingredient. An {@code exists} query, not a count — {@code IngredientService} only needs
     * the boolean, and this stays fast regardless of the ingredient's movement history depth.
     */
    boolean existsByTenantIdAndIngredientId(UUID tenantId, UUID ingredientId);

    /** Bulk variant of {@link #existsByTenantIdAndIngredientId} for list rendering — one query
     * for the whole page's measure-type-lock flags, never one exists-check per row. */
    @Query("SELECT DISTINCT m.ingredientId FROM InventoryMovement m "
            + "WHERE m.tenantId = :tenantId AND m.ingredientId IN :ingredientIds")
    List<UUID> findDistinctIngredientIdsByTenantIdAndIngredientIdIn(
            @Param("tenantId") UUID tenantId, @Param("ingredientIds") Collection<UUID> ingredientIds);
}
