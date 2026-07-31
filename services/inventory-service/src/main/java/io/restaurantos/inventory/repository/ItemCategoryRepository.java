package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.ItemCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
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

    /**
     * Pre-check for {@code uq_item_category_tenant_parent_name}, before the write, so a collision
     * surfaces as {@code CategoryNameDuplicateException} rather than the constraint's raw
     * {@code DataIntegrityViolationException}.
     *
     * <p>Returns the conflicting row itself, not just a boolean — {@code archivedAt} on it is what
     * lets the caller say "already exists, but it's archived" rather than a bare "already exists"
     * that names something invisible in the default (live-only) category list. The constraint
     * makes no such distinction (an archived row still reserves its name), and neither does this
     * check; the row is only read here so the exception can explain why.
     *
     * <p>{@code IS NOT DISTINCT FROM} rather than {@code parentId = :parentId} deliberately —
     * plain {@code =} never matches a NULL parent (two root categories would never collide) while
     * the constraint itself is declared {@code NULLS NOT DISTINCT}. This mirrors that exactly:
     * root categories collide with each other on name, same as any other pair of siblings.
     * {@code excludeId} is null on create and the row's own id on rename, so a category is never
     * reported as colliding with itself.
     */
    @Query(value = "SELECT * FROM item_categories "
            + "WHERE tenant_id = :tenantId AND parent_id IS NOT DISTINCT FROM :parentId "
            + "AND name = :name AND (:excludeId IS NULL OR id <> :excludeId) LIMIT 1", nativeQuery = true)
    Optional<ItemCategory> findSibling(@Param("tenantId") UUID tenantId, @Param("parentId") UUID parentId,
            @Param("name") String name, @Param("excludeId") UUID excludeId);
}
