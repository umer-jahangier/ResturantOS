package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.IngredientUomConversion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface IngredientUomConversionRepository extends JpaRepository<IngredientUomConversion, UUID> {

    List<IngredientUomConversion> findByTenantIdAndIngredientId(UUID tenantId, UUID ingredientId);

    /** Bulk fetch for list rendering — one query for the whole page, never one per ingredient. */
    List<IngredientUomConversion> findByTenantIdAndIngredientIdIn(UUID tenantId, Collection<UUID> ingredientIds);

    @Modifying
    @Transactional
    void deleteByTenantIdAndIngredientId(UUID tenantId, UUID ingredientId);
}
