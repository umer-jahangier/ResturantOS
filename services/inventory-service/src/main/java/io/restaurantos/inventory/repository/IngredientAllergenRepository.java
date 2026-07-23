package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.IngredientAllergen;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface IngredientAllergenRepository extends JpaRepository<IngredientAllergen, UUID> {

    List<IngredientAllergen> findByTenantIdAndIngredientId(UUID tenantId, UUID ingredientId);

    /** Bulk fetch for list rendering — one query for the whole page, never one per ingredient. */
    List<IngredientAllergen> findByTenantIdAndIngredientIdIn(UUID tenantId, Collection<UUID> ingredientIds);

    /**
     * A genuine bulk JPQL DELETE — see {@code IngredientUomConversionRepository}'s identical
     * method for why the entity-based derived-delete flavor is unsafe here (Hibernate's
     * flush-time INSERT-before-DELETE ordering vs. {@code uq_ingredient_allergen}).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query("DELETE FROM IngredientAllergen a WHERE a.tenantId = :tenantId AND a.ingredientId = :ingredientId")
    void deleteByTenantIdAndIngredientId(@Param("tenantId") UUID tenantId, @Param("ingredientId") UUID ingredientId);
}
