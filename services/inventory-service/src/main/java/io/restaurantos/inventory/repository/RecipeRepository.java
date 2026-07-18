package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.Recipe;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
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

    List<Recipe> findByMenuItemIdOrderByVersionDesc(UUID menuItemId);
}
