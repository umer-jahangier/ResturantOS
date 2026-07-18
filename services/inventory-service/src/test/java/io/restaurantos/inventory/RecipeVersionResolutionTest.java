package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.repository.RecipeLineRepository;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * D-01 unit coverage (no Docker/DB): {@code RecipeService.resolveEffectiveRecipe} must select the
 * version whose effective-from window covers the given instant, most-recent-first — NEVER by the
 * "is current" flag. The mocked {@link RecipeRepository}'s stub mirrors the real
 * {@code findEffectiveVersionsDesc} JPQL filter (effectiveFrom &lt;= atInstant, ORDER BY
 * effectiveFrom DESC) so this test exercises the exact resolution semantics without a live
 * database — see {@code RecipeVersionResolutionIT} for the DB-backed proof of the same behavior.
 */
class RecipeVersionResolutionTest {

    private final UUID tenantId = UUID.randomUUID();
    private final UUID menuItemId = UUID.randomUUID();
    private final Instant t1 = Instant.parse("2026-01-01T00:00:00Z");
    private final Instant t2 = t1.plus(7, ChronoUnit.DAYS);

    private RecipeService recipeService;
    private Recipe v1;
    private Recipe v2;

    @BeforeEach
    void setUp() {
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        RecipeLineRepository recipeLineRepository = mock(RecipeLineRepository.class);
        TenantContext tenantContext = mock(TenantContext.class);
        when(tenantContext.requireTenantId()).thenReturn(tenantId);
        recipeService = new RecipeService(recipeRepository, recipeLineRepository, tenantContext);

        // v1 is stale (isCurrent=false) but still effective for its window; v2 is flagged current
        // but must NOT be preferred outside its own window — that is the entire point of D-01.
        v1 = recipe(1, t1, false);
        v2 = recipe(2, t2, true);

        when(recipeRepository.findEffectiveVersionsDesc(eq(tenantId), eq(menuItemId), any()))
                .thenAnswer(invocation -> {
                    Instant atInstant = invocation.getArgument(2);
                    return List.of(v1, v2).stream()
                            .filter(r -> !r.getEffectiveFrom().isAfter(atInstant))
                            .sorted(Comparator.comparing(Recipe::getEffectiveFrom).reversed())
                            .toList();
                });
    }

    private Recipe recipe(int version, Instant effectiveFrom, boolean current) {
        Recipe recipe = new Recipe();
        recipe.setTenantId(tenantId);
        recipe.setMenuItemId(menuItemId);
        recipe.setVersion(version);
        recipe.setEffectiveFrom(effectiveFrom);
        recipe.setCurrent(current);
        return recipe;
    }

    @Test
    void resolvesToV1_whenInstantIsInsideV1V2Window() {
        Optional<Recipe> resolved = recipeService.resolveEffectiveRecipe(menuItemId, t1.plus(1, ChronoUnit.DAYS));

        assertThat(resolved).isPresent();
        assertThat(resolved.get().getVersion()).isEqualTo(1);
    }

    @Test
    void resolvesToV2_whenInstantIsAtOrAfterT2() {
        Optional<Recipe> atT2 = recipeService.resolveEffectiveRecipe(menuItemId, t2);
        Optional<Recipe> afterT2 = recipeService.resolveEffectiveRecipe(menuItemId, t2.plus(1, ChronoUnit.DAYS));

        assertThat(atT2).isPresent();
        assertThat(atT2.get().getVersion()).isEqualTo(2);
        assertThat(afterT2).isPresent();
        assertThat(afterT2.get().getVersion()).isEqualTo(2);
    }

    @Test
    void resolvesToEmpty_whenInstantIsBeforeT1() {
        Optional<Recipe> resolved = recipeService.resolveEffectiveRecipe(menuItemId, t1.minus(1, ChronoUnit.DAYS));

        assertThat(resolved).isEmpty();
    }

    @Test
    void ignoresIsCurrentFlag_stillResolvesToV1InsideItsOwnWindow() {
        assertThat(v1.isCurrent()).isFalse();
        assertThat(v2.isCurrent()).isTrue();

        Optional<Recipe> resolved = recipeService.resolveEffectiveRecipe(menuItemId, t1.plus(1, ChronoUnit.DAYS));

        assertThat(resolved).isPresent();
        assertThat(resolved.get().getVersion()).isEqualTo(1);
    }
}
