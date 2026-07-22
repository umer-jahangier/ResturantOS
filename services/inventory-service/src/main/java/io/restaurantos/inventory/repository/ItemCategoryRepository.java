package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.ItemCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every method carries an explicit {@code tenantId} predicate — FORCE-RLS on
 * {@code item_categories} is defence in depth, not the only isolation mechanism (mirrors
 * {@code IngredientRepository}'s tenant-scoped active-ingredient query convention).
 */
@Repository
public interface ItemCategoryRepository extends JpaRepository<ItemCategory, UUID> {

    List<ItemCategory> findByTenantIdOrderBySortOrderAscNameAsc(UUID tenantId);

    List<ItemCategory> findByTenantIdAndParentIdIsNullOrderBySortOrderAscNameAsc(UUID tenantId);

    List<ItemCategory> findByTenantIdAndParentId(UUID tenantId, UUID parentId);

    long countByTenantIdAndParentIdAndArchivedAtIsNull(UUID tenantId, UUID parentId);

    Optional<ItemCategory> findByTenantIdAndId(UUID tenantId, UUID id);
}
