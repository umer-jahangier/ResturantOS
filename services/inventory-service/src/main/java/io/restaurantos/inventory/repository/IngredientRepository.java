package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.Ingredient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface IngredientRepository extends JpaRepository<Ingredient, UUID> {

    Optional<Ingredient> findBySku(String sku);

    List<Ingredient> findByActiveTrue();

    /**
     * Tenant-scoped variant of {@link #findByActiveTrue()} — carries an explicit
     * {@code tenantId} predicate rather than relying on FORCE-RLS + the Hibernate tenant filter
     * alone (the same defect class CONTEXT.md flags on
     * {@code RecipeRepository.findByMenuItemIdOrderByVersionDesc}). Added for
     * {@code StockLevelService.listStockLevels}, which otherwise leaked every tenant's active
     * ingredients into the per-branch stock read model.
     */
    List<Ingredient> findByTenantIdAndActiveTrue(UUID tenantId);

    /**
     * Idempotently ensures a root (level 1) {@code item_categories} row named {@code name}
     * exists for {@code tenantId} — mirrors V5__item_categories.sql's backfill INSERT verbatim
     * (same {@code uq_item_category_tenant_parent_name} conflict target), so a fresh category
     * created here is indistinguishable from one the migration itself would have backfilled.
     */
    @Modifying
    @Transactional
    @Query(value = "INSERT INTO item_categories (tenant_id, parent_id, level, name) "
            + "VALUES (:tenantId, NULL, 1, :name) "
            + "ON CONFLICT (tenant_id, parent_id, name) DO NOTHING", nativeQuery = true)
    void ensureRootCategory(@Param("tenantId") UUID tenantId, @Param("name") String name);

    @Query(value = "SELECT id FROM item_categories "
            + "WHERE tenant_id = :tenantId AND parent_id IS NULL AND name = :name", nativeQuery = true)
    UUID findRootCategoryId(@Param("tenantId") UUID tenantId, @Param("name") String name);

    /**
     * Resolves the deterministic {@code category_id} for a free-text category value, creating
     * the backing {@code item_categories} root row on first use. Blank/null resolves to
     * {@code "Uncategorized"}, exactly matching V5's migration-time backfill rule — until a
     * later wave adds real category selection, this keeps the pre-existing free-text
     * {@code CreateIngredientRequest.category()} input working against the now-NOT-NULL
     * {@code ingredients.category_id} column.
     */
    default UUID resolveOrCreateCategoryId(UUID tenantId, String categoryText) {
        String name = (categoryText == null || categoryText.isBlank()) ? "Uncategorized" : categoryText.trim();
        ensureRootCategory(tenantId, name);
        return findRootCategoryId(tenantId, name);
    }
}
