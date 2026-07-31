package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.Recipe;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RecipeRepository extends JpaRepository<Recipe, UUID> {

    /**
     * D-01: resolves the recipe version(s) whose effective-from window covers {@code atInstant},
     * most-recent-first. Deliberately does NOT filter on the "current" flag — depletion (08-05)
     * must select the version effective at the order's closedAt, not whichever version happens to
     * be flagged as the latest edit right now. Callers take {@code .get(0)} / {@code findFirst()}
     * of the returned list for the resolved version.
     */
    @Query("SELECT r FROM Recipe r WHERE r.tenantId = :tenantId AND r.menuItemId = :menuItemId "
            + "AND r.effectiveFrom <= :atInstant ORDER BY r.effectiveFrom DESC")
    List<Recipe> findEffectiveVersionsDesc(
            @Param("tenantId") UUID tenantId,
            @Param("menuItemId") UUID menuItemId,
            @Param("atInstant") Instant atInstant);

    /** Tenant-scoped replacement for the deleted, un-scoped {@code findByMenuItemIdOrderByVersionDesc}. */
    List<Recipe> findByTenantIdAndMenuItemIdOrderByVersionDesc(UUID tenantId, UUID menuItemId);

    /**
     * INV-15: batch fetch of every version for a set of menu items, most-recent-effective-first,
     * for the coverage report's single grouping query (replaces an N+1 of per-item
     * {@code resolveEffectiveRecipe} calls).
     */
    List<Recipe> findByTenantIdAndMenuItemIdInOrderByEffectiveFromDesc(
            UUID tenantId, Collection<UUID> menuItemIds);

    /** Tenant-scoped single-row lookup — validates {@code Ingredient.producedByRecipeId} on write
     * so a prep item can never point at another tenant's recipe, or at nothing at all. */
    Optional<Recipe> findByTenantIdAndId(UUID tenantId, UUID id);

    /**
     * Every menu item's latest-edited version, for the ingredient form's "Produced by" picker.
     * Uses the {@code current} flag rather than {@code effectiveFrom <= now}, unlike the coverage
     * report: this is an authoring picker, so what a manager is choosing between is the version
     * they last edited, including one they have scheduled for next week.
     */
    List<Recipe> findByTenantIdAndCurrentTrue(UUID tenantId);
}
