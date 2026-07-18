package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DB-backed proof of D-01: {@code RecipeService.resolveEffectiveRecipe} (and the
 * {@code findEffectiveVersionsDesc} JPQL it delegates to) resolve by the
 * {@code effective_from} window against the given instant — NOT by the {@code is_current} flag.
 * v1 is persisted with {@code isCurrent=false} and v2 with {@code isCurrent=true}, yet an instant
 * inside v1's window still resolves to v1: proof that a mid-service recipe edit (which flips
 * is_current) cannot retroactively change how an already-placed order (closedAt inside v1's
 * window) depletes. This is the exact seam 08-05's depletion consumer relies on.
 */
class RecipeVersionResolutionIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired RecipeRepository recipeRepository;
    @Autowired RecipeService recipeService;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;
    Instant t1;
    Instant t2;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        menuItemId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        t1 = Instant.now().minus(30, ChronoUnit.DAYS);
        t2 = Instant.now().minus(1, ChronoUnit.DAYS);

        // v1: stale is_current=false, still effective for its own window [t1, t2).
        Recipe v1 = new Recipe();
        v1.setTenantId(tenantId);
        v1.setMenuItemId(menuItemId);
        v1.setVersion(1);
        v1.setCurrent(false);
        v1.setEffectiveFrom(t1);
        v1.setYieldServings(BigDecimal.TEN);
        v1.setName("House Burger v1");
        recipeRepository.save(v1);

        // v2: flagged is_current=true — but effective only from t2 onward.
        Recipe v2 = new Recipe();
        v2.setTenantId(tenantId);
        v2.setMenuItemId(menuItemId);
        v2.setVersion(2);
        v2.setCurrent(true);
        v2.setEffectiveFrom(t2);
        v2.setYieldServings(BigDecimal.TEN);
        v2.setName("House Burger v2");
        recipeRepository.save(v2);
    }

    @Test
    void resolvesToV1_whenInstantIsInsideV1V2Window_ignoringIsCurrentOnV2() {
        Instant insideV1Window = t1.plus(1, ChronoUnit.DAYS);

        Optional<Recipe> resolved = recipeService.resolveEffectiveRecipe(menuItemId, insideV1Window);

        assertThat(resolved).isPresent();
        assertThat(resolved.get().getVersion()).isEqualTo(1);
        assertThat(resolved.get().isCurrent()).isFalse();
    }

    @Test
    void resolvesToV2_whenInstantIsAtOrAfterT2() {
        Optional<Recipe> resolved = recipeService.resolveEffectiveRecipe(menuItemId, t2);

        assertThat(resolved).isPresent();
        assertThat(resolved.get().getVersion()).isEqualTo(2);

        Optional<Recipe> resolvedLater =
                recipeService.resolveEffectiveRecipe(menuItemId, Instant.now());
        assertThat(resolvedLater).isPresent();
        assertThat(resolvedLater.get().getVersion()).isEqualTo(2);
    }

    @Test
    void resolvesToEmpty_whenInstantIsBeforeT1() {
        Instant beforeT1 = t1.minus(1, ChronoUnit.DAYS);

        Optional<Recipe> resolved = recipeService.resolveEffectiveRecipe(menuItemId, beforeT1);

        assertThat(resolved).isEmpty();
    }
}
