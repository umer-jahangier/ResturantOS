package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

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
}
